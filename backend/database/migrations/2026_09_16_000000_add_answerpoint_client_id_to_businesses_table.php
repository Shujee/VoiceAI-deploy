<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            // AnswerPoint's own numeric client identifier for this business
            // (their "Create Message" API requires it on every POST - see
            // app/Services/AnswerPoint/AnswerPointClient.php). Assigned by
            // the AnswerPoint/CodeIgniter team per business, not something
            // we generate - null until they hand us a value, and the push
            // is skipped entirely for any business where this is still
            // null (see PushCallLogToAnswerPoint::shouldPush()).
            $table->unsignedInteger('answerpoint_client_id')->nullable()->after('voice_id');
        });
    }

    public function down(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            $table->dropColumn('answerpoint_client_id');
        });
    }
};
