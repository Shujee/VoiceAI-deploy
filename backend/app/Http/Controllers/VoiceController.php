<?php

namespace App\Http\Controllers;

use Illuminate\Http\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class VoiceController extends Controller
{
    // Curated static list (config/cartesia_voices.php), not live-fetched
    // from Cartesia - see that file's comment for why. Was
    // config/rime_voices.php before the 2026-09-02 switch to Cartesia;
    // that file is left on disk (unused) rather than deleted, in case
    // Rime is ever revisited.
    public function index()
    {
        return response()->json(config('cartesia_voices.voices'));
    }

    // "Hear a sample" button on the business edit page's voice picker.
    // Proxies to ai-runtime (see routes/voices.ts,
    // ai-runtime/src/tts/synthesizeVoicePreview.ts) rather than calling
    // Cartesia directly from here, because CARTESIA_API_KEY only lives
    // in ai-runtime/.env - this backend was never given its own copy.
    // Generates a fresh clip on every request (no caching) - a single
    // short Cartesia synthesis call is cheap enough that caching wasn't
    // worth the extra moving part.
    public function preview(string $voiceId)
    {
        $baseUrl = rtrim(config('services.ai_runtime.base_url'), '/');

        try {
            $response = Http::timeout(15)->get("{$baseUrl}/voices/{$voiceId}/preview");
        } catch (\Throwable $e) {
            Log::warning('Voice preview: could not reach ai-runtime', [
                'voice_id' => $voiceId,
                'error' => $e->getMessage(),
            ]);

            return response()->json(['message' => 'Could not reach the voice service.'], 502);
        }

        if ($response->failed()) {
            // ai-runtime already logs the real Cartesia error - just pass
            // its status/body through rather than swallowing detail into
            // a generic 502 here.
            return response($response->body(), $response->status());
        }

        return response($response->body(), Response::HTTP_OK, [
            'Content-Type' => $response->header('Content-Type') ?: 'audio/wav',
            'Cache-Control' => 'no-store',
        ]);
    }
}
