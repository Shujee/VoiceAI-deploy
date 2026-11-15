<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('call_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_id')->constrained()->cascadeOnDelete();
            $table->string('livekit_room');
            // From SIP participant attributes (sip.phoneNumber) when
            // available - nullable since not every call path guarantees it.
            $table->string('caller_number')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('ended_at')->nullable();
            // Ordered list of {role, text, at} turns - written once at call
            // end by ai-runtime, not streamed live.
            $table->json('raw_transcript')->nullable();
            // Structured fields extracted from the transcript by one extra
            // (off-hot-path) LLM call at call end - see test-token.ts.
            $table->string('caller_name')->nullable();
            $table->string('callback_number')->nullable();
            $table->text('address')->nullable();
            $table->text('message')->nullable();
            // Mirrors the prompt's PATH routing (see buildSystemPrompt.ts):
            // quote_request / complaint / callback / message / faq / cold_call.
            $table->string('call_type')->nullable();
            // Denormalized usage counters, not a separate usage_events table
            // - simplest thing that supports the Usage page's cost estimate
            // (see config/provider_pricing.php) without overengineering for
            // a single-admin demo tool.
            $table->unsignedInteger('llm_prompt_tokens')->nullable();
            $table->unsignedInteger('llm_completion_tokens')->nullable();
            $table->unsignedInteger('tts_characters')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('call_logs');
    }
};
