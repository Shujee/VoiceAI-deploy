<?php

namespace App\Jobs;

use App\Models\CallLog;
use App\Services\AnswerPoint\AnswerPointClient;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

// Queued (not sent inline from CallLogController::store()) so a slow or
// down AnswerPoint endpoint can never delay or fail the actual call-log
// save that ai-runtime is waiting on for its own response. Runs on the
// same 'redis' queue connection already used for everything else in this
// app (see backend/.env's QUEUE_CONNECTION and the composer "dev" script's
// `queue:listen`).
class PushCallLogToAnswerPoint implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $backoff = 30;

    public function __construct(public int $callLogId)
    {
    }

    public function handle(AnswerPointClient $client): void
    {
        $callLog = CallLog::find($this->callLogId);

        // Deleted/missing by the time this ran - nothing to push, and not
        // worth retrying.
        if (! $callLog)
            return;

        if (! self::shouldPush($callLog))
            return;

        $client->send($callLog);
    }

    // Centralized here (rather than only checked in CallLogController) so
    // a job re-dispatched later for any reason (e.g. manually from
    // Tinker, to backfill an old call once a business's clientId gets
    // added) gets the same gating as the original automatic dispatch.
    public static function shouldPush(CallLog $callLog): bool
    {
        // Global kill switch - stays false while AnswerPoint push isn't
        // live yet (see config/services.php). Checked first regardless of
        // any business's own opt-in below, so flipping a business's toggle
        // on in the dashboard has no effect until this is deliberately
        // turned on too.
        if (! config('services.answerpoint.enabled'))
            return false;

        $business = $callLog->relationLoaded('business')
            ? $callLog->business
            : $callLog->business()->first();

        if (! $business?->answerpoint_client_id)
            return false;

        // Per-business opt-in (2026-09-24): the client asked to keep the
        // dashboard's own call logs separate from AnswerPoint for now, so
        // a business only pushes there once someone explicitly turns this
        // on for it - see businesses.answerpoint_push_enabled and the
        // toggle on the business edit page. Defaults to false, so existing
        // and newly-synced businesses stay opted out until changed.
        if (! $business->answerpoint_push_enabled)
            return false;

        // AnswerPoint marks 'forename' and 'message' as required (Yes) -
        // skip rather than send a request we already know it will reject
        // with its documented 400, and rather than invent content for
        // either field. A call with no caller name and/or no message
        // captured (e.g. a pure FAQ answer, a hangup, a cold call) isn't
        // the kind of "customer left a message" record this API is for.
        return filled($callLog->caller_name) && filled($callLog->message);
    }
}
