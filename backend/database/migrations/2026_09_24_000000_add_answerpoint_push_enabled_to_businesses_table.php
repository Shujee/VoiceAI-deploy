<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            // Per-business opt-in for pushing this business's call logs to
            // AnswerPoint (the client's old system) via
            // PushCallLogToAnswerPoint/AnswerPointClient::send(). Defaults
            // to false: the client asked (2026-09-24) to keep the new
            // dashboard's logging separate from the old system for now, so
            // no business should push there until someone explicitly turns
            // this on for it in the dashboard. This sits ALONGSIDE the
            // existing global services.answerpoint.enabled kill switch, not
            // instead of it - both must be true for a push to fire (see
            // PushCallLogToAnswerPoint::shouldPush()), so flipping this on
            // for a business has no effect while the global switch stays
            // off.
            $table->boolean('answerpoint_push_enabled')->default(false)->after('answerpoint_client_id');
        });
    }

    public function down(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            $table->dropColumn('answerpoint_push_enabled');
        });
    }
};
