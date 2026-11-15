<?php

// Curated subset of Rime's Coda-model voice catalog for the dashboard's
// voice picker. Static rather than live-fetched from Rime's full voice
// list (docs.rime.ai/docs/voices) so the picker doesn't depend on an
// external call and stays demo-safe. Voice ids match Rime's API exactly -
// a business's voice_id (set here from the dashboard) is read by
// ai-runtime/src/tts/RimeTTS.ts (falls back to its own DEFAULT_SPEAKER,
// 'astra', when unset) - wired end to end as of Aug 29 2026.
return [
    'voices' => [
        ['id' => 'astra', 'name' => 'Astra', 'description' => 'Bright, lively Californian; quick and expressive.'],
        ['id' => 'luna', 'name' => 'Luna', 'description' => 'A bright, lively female voice; energetic with a casual core.'],
        ['id' => 'lintel', 'name' => 'Lintel', 'description' => 'A warm young American voice; both polished and lively.'],
        ['id' => 'eyre', 'name' => 'Eyre', 'description' => 'A warm, friendly American voice; calm and easy to listen to.'],
        ['id' => 'masonry', 'name' => 'Masonry', 'description' => 'A confident, low Southern voice; authoritative without being loud.'],
        ['id' => 'bancroft', 'name' => 'Bancroft', 'description' => 'A composed American voice; strong on professional and formal contexts.'],
        ['id' => 'beatty', 'name' => 'Beatty', 'description' => 'An easygoing, distinctly casual American male voice.'],
        ['id' => 'cupola', 'name' => 'Cupola', 'description' => 'A confident, energetic American voice; professional with warmth.'],
        ['id' => 'marlu', 'name' => 'Marlu', 'description' => 'An older Australian voice; low, mature, unhurried.'],
        ['id' => 'hesse', 'name' => 'Hesse', 'description' => 'A relaxed, easygoing female voice.'],
        // British English voices (Rime's Coda catalog, docs.rime.ai/docs/voices-coda) -
        // added Sep 2026 per client feedback asking for a British accent
        // instead of the American/Australian voices above.
        ['id' => 'albion', 'name' => 'Albion', 'description' => 'A calm, even-keeled younger British male voice.'],
        ['id' => 'vashti', 'name' => 'Vashti', 'description' => 'A bright, expressive younger British female voice.'],
        ['id' => 'fuzz', 'name' => 'Fuzz', 'description' => 'A polished, formal older British male voice.'],
    ],
];
