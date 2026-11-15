<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'business_id', 'livekit_room', 'caller_number', 'started_at', 'ended_at',
    'raw_transcript', 'caller_name', 'callback_number', 'postcode', 'address', 'message',
    'call_type', 'llm_prompt_tokens', 'llm_completion_tokens', 'tts_characters',
])]
class CallLog extends Model
{
    protected function casts(): array
    {
        return [
            'raw_transcript' => 'array',
            'started_at' => 'datetime',
            'ended_at' => 'datetime',
        ];
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }
}
