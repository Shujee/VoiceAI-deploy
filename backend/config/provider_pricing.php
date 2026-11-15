<?php

// Published per-unit pricing used ONLY to compute a self-tracked spend
// ESTIMATE on the dashboard's Usage page - neither Groq nor Rime expose a
// live "remaining credit balance" API (confirmed against both providers'
// current docs, Aug 2026), so this is the closest useful substitute: our
// own logged usage x their published rate. Verify against
// console.groq.com/docs/models and rime.ai/pricing before trusting this
// for anything beyond a rough estimate - these change over time and this
// file is not kept in sync automatically.
return [
    'groq' => [
        'model' => 'openai/gpt-oss-20b',
        'input_per_million_tokens' => 0.075,
        'output_per_million_tokens' => 0.30,
    ],
    'rime' => [
        'model' => 'coda',
        'per_thousand_characters' => 0.05,
    ],
];
