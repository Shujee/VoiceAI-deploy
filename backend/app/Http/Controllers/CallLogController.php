<?php

namespace App\Http\Controllers;

use App\Jobs\PushCallLogToAnswerPoint;
use App\Models\Business;
use App\Models\CallLog;
use Illuminate\Http\Request;

class CallLogController extends Controller
{
    // Admin-only, paginated, optionally filtered by business - for the
    // dashboard's Call Logs list page.
    public function index(Request $request)
    {
        $query = CallLog::with('business')->latest('started_at');

        if ($request->filled('business_id'))
            $query->where('business_id', $request->input('business_id'));

        return $query->paginate(25);
    }

    public function show(CallLog $callLog)
    {
        return $callLog->load('business');
    }

    // Internal ingestion endpoint - ai-runtime POSTs here once, at the end
    // of each call (see ai-runtime/src/services/CallLogClient.ts), guarded
    // by the runtime.key middleware (a shared secret, not a browser
    // session - see VerifyRuntimeApiKey). NOT the endpoint AnswerPoint's
    // CodeIgniter app calls - that's the other direction entirely: once
    // this method saves the call, it dispatches PushCallLogToAnswerPoint
    // to POST a summary of it OUT to AnswerPoint's own API (see
    // app/Services/AnswerPoint/AnswerPointClient.php).
    public function store(Request $request)
    {
        $data = $request->validate([
            'business_slug' => ['required', 'string', 'exists:businesses,slug'],
            'livekit_room' => ['required', 'string'],
            'caller_number' => ['nullable', 'string'],
            'started_at' => ['nullable', 'date'],
            'ended_at' => ['nullable', 'date'],
            'raw_transcript' => ['nullable', 'array'],
            'caller_name' => ['nullable', 'string'],
            'callback_number' => ['nullable', 'string'],
            'address' => ['nullable', 'string'],
            'postcode' => ['nullable', 'string'],
            'message' => ['nullable', 'string'],
            'call_type' => ['nullable', 'string'],
            'llm_prompt_tokens' => ['nullable', 'integer'],
            'llm_completion_tokens' => ['nullable', 'integer'],
            'tts_characters' => ['nullable', 'integer'],
        ]);

        $business = Business::where('slug', $data['business_slug'])->firstOrFail();

        $callLog = CallLog::create([
            ...collect($data)->except('business_slug')->all(),
            'business_id' => $business->id,
        ]);

        // Fire-and-forget push to AnswerPoint (the client's existing
        // CodeIgniter support platform - see voiceai_runtime_status.md).
        // PushCallLogToAnswerPoint::shouldPush() gates this: disabled by
        // default, requires this business's answerpoint_client_id, and
        // requires a caller_name + message to actually relay. Queued, so
        // a slow or unreachable AnswerPoint can never affect this
        // response to ai-runtime.
        PushCallLogToAnswerPoint::dispatch($callLog->id);

        return response()->json($callLog, 201);
    }
}
