<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            // A Rime voice id (see config/rime_voices.php for the curated
            // list this is picked from). Null = ai-runtime falls back to
            // its current hardcoded default ('astra' in RimeTTS.ts) - this
            // column isn't read by ai-runtime yet, that wiring lands
            // alongside the dynamic per-call business resolution work.
            $table->string('voice_id')->nullable()->after('slug');
        });
    }

    public function down(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            $table->dropColumn('voice_id');
        });
    }
};
