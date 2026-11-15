<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('businesses', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('slug')->unique();
            // Structured KB fields (per-business). Kept as plain text rather
            // than richer sub-tables for now - a business's basic info fits
            // in a paragraph or two, and this is injected directly into the
            // LLM system prompt as-is (see ai-runtime/src/llm/OpenAILLM.ts).
            // Move to a proper documents/RAG model only if a business's
            // content genuinely outgrows a prompt-sized block.
            $table->text('services')->nullable();
            $table->text('hours')->nullable();
            $table->text('pricing')->nullable();
            $table->text('policies')->nullable();
            $table->json('faq')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('businesses');
    }
};
