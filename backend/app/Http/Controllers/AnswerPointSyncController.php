<?php

namespace App\Http\Controllers;

use App\Services\AnswerPoint\AnswerPointClientSync;
use Illuminate\Http\JsonResponse;

// Single admin action behind the businesses/index.vue "Sync now" button -
// manual-trigger only (see AnswerPointClientSync's own comment for why),
// no scheduled job. Pulls AnswerPoint's real client list in and reconciles
// it into businesses/phone_numbers.
class AnswerPointSyncController extends Controller
{
    public function sync(AnswerPointClientSync $sync): JsonResponse
    {
        $stats = $sync->sync();

        return response()->json($stats);
    }
}
