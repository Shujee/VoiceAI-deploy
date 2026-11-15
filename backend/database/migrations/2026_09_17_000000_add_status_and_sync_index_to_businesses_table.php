<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            // Reflects AnswerPoint's own client status once synced (see
            // AnswerPointClientSync::sync()) - defaults to 'active' so the
            // demo-seeded businesses (no answerpoint_client_id at all) and
            // any locally-created ones stay visible/usable exactly as
            // before. Plain string rather than a DB enum - matches this
            // schema's existing style (call_type, etc.) and keeps adding a
            // third status later a one-line change, not a migration.
            $table->string('status')->default('active')->after('answerpoint_client_id');

            // Lets AnswerPointClientSync upsert by this id safely (find-or-
            // create per client) instead of accidentally creating duplicate
            // rows for the same AnswerPoint client on a second sync. NULL
            // is allowed to repeat under a unique index (both MySQL and
            // Postgres treat NULLs as distinct) - it does not affect the
            // demo/local businesses, which all leave this column null.
            $table->unique('answerpoint_client_id');
        });
    }

    public function down(): void
    {
        Schema::table('businesses', function (Blueprint $table) {
            $table->dropUnique(['answerpoint_client_id']);
            $table->dropColumn('status');
        });
    }
};
