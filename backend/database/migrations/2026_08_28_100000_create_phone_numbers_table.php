<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('phone_numbers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('business_id')->constrained()->cascadeOnDelete();
            // Not strictly validated as E.164 for now - this is a demo-stage
            // admin tool, not a carrier-facing form. Real inbound routing by
            // this number (matching it against the dialed SIP number) is
            // deliberately NOT wired yet - see voiceai_runtime_status.md.
            $table->string('number')->unique();
            $table->string('label')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('phone_numbers');
    }
};
