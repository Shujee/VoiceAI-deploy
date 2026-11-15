<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Per-business choice of system prompt (2026-10-14): 'standard' is the
// long, scenario-by-scenario prompt; 'compact' is the short principles-only
// prompt being trialled against it (see ai-runtime's buildSystemPrompt.ts).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            $table->string('prompt_style')->default('standard')->after('voice_id');
        });
    }

    public function down(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            $table->dropColumn('prompt_style');
        });
    }
};
