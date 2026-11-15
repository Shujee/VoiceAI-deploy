<?php

namespace App\Services\AnswerPoint;

use App\Models\Business;
use App\Models\CallLog;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

// Thin wrapper around AnswerPoint's "Create Message" API (the client's
// existing CodeIgniter platform human support agents already use) - see
// voiceai_runtime_status.md for background and config/services.php for the
// account-wide config this reads. One call per finished VoiceAI phone call,
// dispatched from PushCallLogToAnswerPoint so a slow/down AnswerPoint never
// blocks or fails the actual call-log save in CallLogController::store().
class AnswerPointClient
{
    /**
     * @return bool true on AnswerPoint's documented 201 ("added
     *              successfully"), false on anything else - the caller
     *              (the queued job) decides whether that's worth retrying.
     */
    public function send(CallLog $callLog): bool
    {
        $business = $callLog->business;

        if (! $business?->answerpoint_client_id) {
            // Shouldn't normally get here - PushCallLogToAnswerPoint checks
            // this before dispatching - but guard anyway since this method
            // may get called directly (e.g. from Tinker) too.
            Log::warning('AnswerPoint push skipped: business has no answerpoint_client_id.', [
                'call_log_id' => $callLog->id,
                'business_id' => $callLog->business_id,
            ]);

            return false;
        }

        $response = Http::timeout(10)
            ->post(config('services.answerpoint.base_url'), $this->buildPayload($callLog, $business));

        if ($response->status() !== 201) {
            Log::error('AnswerPoint createMessage call failed.', [
                'call_log_id' => $callLog->id,
                'status' => $response->status(),
                'body' => $response->body(),
            ]);

            return false;
        }

        return true;
    }

    // No auth header/token - confirmed 2026-09-16 against AnswerPoint's own
    // Flutter app source (client-provided ap_app folder): every endpoint in
    // that app (login, filterMessages, clientMessages/{id}, etc.) uses a
    // plain `Dio()` with zero BaseOptions/interceptors/headers anywhere -
    // grepping the whole lib/ tree for "headers"/"Authorization"/"Bearer"
    // turns up nothing. login/main only returns account identity
    // (client_id, client_name) for the app to remember locally; it isn't
    // exchanged for a token. Every subsequent call authenticates purely by
    // supplying the correct id (clientId here, client_id elsewhere in
    // their API - naming is inconsistent controller-to-controller in what
    // is clearly a fairly simple CodeIgniter app) - exactly matching what
    // the createMessage spec originally documented. So: no bearer login
    // step needed after all: config('services.answerpoint.api_key') is
    // unused for now, left in config/services.php only in case that
    // changes.

    // Maps our call_logs columns onto AnswerPoint's documented field names.
    // Several of their fields have no equivalent in our schema at all
    // (title, company, houseNo/address2/address3/town/county/postCode,
    // workTel/workExt, email, howdid, appointment) - all left blank rather
    // than guessed at, since AnswerPoint marks them optional ("Required:
    // No") and inventing values would put worse data into a real support
    // agent's hands than leaving a field empty.
    private function buildPayload(CallLog $callLog, Business $business): array
    {
        [$forename, $surname] = $this->splitName($callLog->caller_name);

        return [
            'clientId' => $business->answerpoint_client_id,
            'title' => '',
            'forename' => $forename,
            'surname' => $surname,
            'company' => '',
            'houseNo' => '',
            // Our address column is the property/street line only
            // (postcode is captured separately - see 'postCode' below) - it
            // goes into address1 as-is. houseNo/address2/address3/town/
            // county have no equivalent in our schema at all and are left
            // blank rather than guessed at.
            'address1' => (string) ($callLog->address ?? ''),
            'address2' => '',
            'address3' => '',
            'town' => '',
            'county' => '',
            // Split out from the free-text address blob (2026-09-17) into
            // its own dedicated slot, since AnswerPoint's spec has one -
            // see call_logs' postcode column and CallLogExtractor.ts.
            'postCode' => (string) ($callLog->postcode ?? ''),
            // callback_number is the number the caller explicitly asked to
            // be reached back on - homeTel reads as the primary contact
            // number in AnswerPoint's sample, so that's the better fit.
            // caller_number (the number they dialed FROM, per SIP
            // attributes) goes in phoneTel as a secondary number, only
            // when it's actually different from callback_number.
            'homeTel' => (string) ($callLog->callback_number ?? $callLog->caller_number ?? ''),
            'phoneTel' => ($callLog->caller_number && $callLog->caller_number !== $callLog->callback_number)
                ? (string) $callLog->caller_number
                : '',
            'workTel' => '',
            'workExt' => '',
            'email' => '',
            // AnswerPoint's own spec disagrees with itself on this field's
            // spelling ("messaage" in their sample JSON, "message" in their
            // parameter table) - going with the parameter table's spelling
            // per confirmation; revisit if AnswerPoint rejects/ignores it
            // in practice.
            'message' => (string) $callLog->message,
            'howdid' => '',
            'appointment' => '',
        ];
    }

    /**
     * @return array<int, array<string, mixed>> raw decoded client records,
     *         untransformed - AnswerPointClientSync::normalizeClient() is
     *         where the actual field-name guessing/mapping lives, kept
     *         separate so only one place needs editing once the real
     *         response shape is confirmed.
     */
    public function fetchClients(): array
    {
        $url = config('services.answerpoint.clients_url');

        if (! $url) {
            throw new \RuntimeException(
                'ANSWERPOINT_CLIENTS_URL is not configured - the "list all '
                .'clients" endpoint was requested from AnswerPoint\'s team '
                .'2026-09-17 but not yet received. Set it in .env once known.'
            );
        }

        $response = Http::timeout(15)->get($url);

        if (! $response->successful()) {
            throw new \RuntimeException(
                "AnswerPoint client-list request failed: HTTP {$response->status()} - {$response->body()}"
            );
        }

        // TODO: response envelope unconfirmed - guessing a flat JSON array
        // of client objects (createMessage's own style). If AnswerPoint
        // wraps it (e.g. {"data": [...]} like login.dart's response
        // shape), adjust this one line.
        $decoded = $response->json();

        return is_array($decoded) ? $decoded : ($decoded['data'] ?? []);
    }

    private function splitName(?string $callerName): array
    {
        $callerName = trim((string) $callerName);

        if ($callerName === '')
            return ['', ''];

        $parts = preg_split('/\s+/', $callerName, 2);

        return [$parts[0], $parts[1] ?? ''];
    }
}
