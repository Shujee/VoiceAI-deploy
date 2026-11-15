<?php

namespace App\Http\Controllers;

use App\Services\LiveKit\TokenService;
use Illuminate\Http\Request;

class LiveKitController extends Controller
{
    public function token(Request $request, TokenService $tokens)
    {
        return response()->json([
            'token' => $tokens->create(
                $request->input('identity', 'voiceai-runtime'),
                $request->input('room', 'test-room'),
            ),
        ]);
    }
}