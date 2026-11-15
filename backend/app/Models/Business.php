<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['name', 'slug', 'voice_id', 'prompt_style', 'answerpoint_client_id', 'answerpoint_push_enabled', 'status', 'services', 'hours', 'pricing', 'policies', 'faq', 'products'])]
class Business extends Model
{
    protected function casts(): array
    {
        return [
            'faq' => 'array',
            'products' => 'array',
            'answerpoint_push_enabled' => 'boolean',
        ];
    }

    public function phoneNumbers(): HasMany
    {
        return $this->hasMany(PhoneNumber::class);
    }

    public function callLogs(): HasMany
    {
        return $this->hasMany(CallLog::class);
    }
}
