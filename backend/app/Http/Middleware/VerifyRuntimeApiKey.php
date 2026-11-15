<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

// Guards the internal call-log ingestion endpoint that ai-runtime (a
// server process, not a browser session) POSTs to at the end of each
// call. Deliberately separate from Sanctum's session auth (that's for the
// dashboard's human login) and from whatever auth the future CodeIgniter
// integration ends up using (see voiceai_runtime_status.md) - this is
// just a shared secret between ai-runtime and this backend.
class VerifyRuntimeApiKey
{
    public function handle(Request $request, Closure $next): Response
    {
        $expected = config('services.runtime.api_key');

        if (! $expected || ! hash_equals($expected, (string) $request->header('X-Runtime-Api-Key'))) {
            abort(401, 'Invalid or missing runtime API key.');
        }

        return $next($request);
    }
}
