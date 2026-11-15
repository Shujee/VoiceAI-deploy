<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('call_logs', function (Blueprint $table) {
            // Split out from the free-text 'address' column (2026-09-17) so
            // AnswerPoint's createMessage push can use its own dedicated
            // 'postCode' field instead of folding everything into address1
            // - see AnswerPointClient::buildPayload() and
            // CallLogExtractor.ts.
            $table->string('postcode')->nullable()->after('address');
        });
    }

    public function down(): void
    {
        Schema::table('call_logs', function (Blueprint $table) {
            $table->dropColumn('postcode');
        });
    }
};
