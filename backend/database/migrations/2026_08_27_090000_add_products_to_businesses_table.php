<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            // Structured product catalog (name/price/availability) for
            // businesses that sell hardware, not just services - keeps
            // this separate from the free-text `services` field so
            // ai-runtime can render it as a clean list the LLM can quote
            // directly, rather than parsing prices out of a paragraph.
            $table->json('products')->nullable()->after('policies');
        });
    }

    public function down(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            $table->dropColumn('products');
        });
    }
};
