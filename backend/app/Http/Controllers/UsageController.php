<?php

namespace App\Http\Controllers;

use App\Models\CallLog;
use Illuminate\Http\Request;

// Self-tracked usage/cost ESTIMATE, not a live balance check - neither Groq
// nor Rime expose an API for that (confirmed against both providers'
// current docs, Aug 2026). See config/provider_pricing.php for the rates
// this multiplies against, and its own comment for the caveat that these
// numbers can drift from what's actually published.
class UsageController extends Controller
{
    public function summary(Request $request)
    {
        $query = CallLog::query();

        if ($request->filled('business_id'))
            $query->where('business_id', $request->input('business_id'));

        $totals = $query->selectRaw(
            'COALESCE(SUM(llm_prompt_tokens), 0) as llm_prompt_tokens, ' .
            'COALESCE(SUM(llm_completion_tokens), 0) as llm_completion_tokens, ' .
            'COALESCE(SUM(tts_characters), 0) as tts_characters, ' .
            'COUNT(*) as call_count'
        )->first();

        $pricing = config('provider_pricing');

        $groqCost = ($totals->llm_prompt_tokens / 1_000_000) * $pricing['groq']['input_per_million_tokens']
            + ($totals->llm_completion_tokens / 1_000_000) * $pricing['groq']['output_per_million_tokens'];

        $rimeCost = ($totals->tts_characters / 1000) * $pricing['rime']['per_thousand_characters'];

        return response()->json([
            'call_count' => (int) $totals->call_count,
            'groq' => [
                'model' => $pricing['groq']['model'],
                'prompt_tokens' => (int) $totals->llm_prompt_tokens,
                'completion_tokens' => (int) $totals->llm_completion_tokens,
                'estimated_cost_usd' => round($groqCost, 4),
                'dashboard_url' => 'https://console.groq.com/dashboard/usage',
            ],
            'rime' => [
                'model' => $pricing['rime']['model'],
                'characters' => (int) $totals->tts_characters,
                'estimated_cost_usd' => round($rimeCost, 4),
                'dashboard_url' => 'https://app.rime.ai/billing',
            ],
        ]);
    }
}
