<?php

// Curated list of Cartesia voice ids for the dashboard's voice picker.
// Static (like the old rime_voices.php this replaces), not live-fetched
// from Cartesia's API, so the picker doesn't depend on an external call.
//
// All entries below are real, confirmed voice ids pulled directly from
// Cartesia's own /voices API response (fetched 2026-09-25, filtered to
// country=GB) - not guessed or scraped from marketing pages. Gemma is
// the one confirmed working in real-call testing (see
// ai-runtime/src/tts/CartesiaTTS.ts's DEFAULT_VOICE_ID); the rest carry
// real ids/names/descriptions from Cartesia but haven't been call-tested
// yet. Complete GB roster as of 2026-09-25: 14 feminine + 31 masculine
// (both gender filters paged to has_more=false, so this is everything
// Cartesia has under country=GB right now).
// Cartesia's own data has two pairs of same-named voices (different ids,
// same description, different taglines) - 'Griffin'/'Griffin (Excited)'
// and 'Benedict'/'Benedict (Royal Narrator)' - suffixed to disambiguate
// in the picker.
// CartesiaTTS.ts already validates that any voice_id passed through
// actually looks like a Cartesia UUID before using it, so a bad/missing
// id just falls back to Gemma rather than breaking a call.
return [
    'voices' => [
        ['id' => '62ae83ad-4f6a-430b-af41-a9bede9286ca', 'name' => 'Gemma', 'description' => 'Confident, emotive British female for professional assistance'],
        ['id' => 'c46cf1f6-49a1-4d67-9a57-ff859a4046d3', 'name' => 'Cora', 'description' => 'Cora offers a helpful and articulate tone, perfectly suited for customer support and service-oriented communication.'],
        ['id' => '273f9ef7-9fc2-4def-88bb-ab108c6249ca', 'name' => 'Julia', 'description' => 'Soft, graceful tone with a composed rhythm for polished guidance and reassurance.'],
        ['id' => 'dc30854e-e398-4579-9dc8-16f6cb2c19b9', 'name' => 'Victoria', 'description' => 'Crisp, professional British female for reassuring communication.'],
        ['id' => 'e5d4c33a-d8f6-46e8-a10f-b5afecc35648', 'name' => 'Evie', 'description' => 'Formal British female for high-level corporate interactions.'],
        ['id' => '16a4052e-1f11-47ac-95f5-9330bee062f9', 'name' => 'Courtney', 'description' => 'Warm, professional, measured delivery, perfect for complex information and professional guidance.'],
        ['id' => '81cd8d19-45e7-47b2-ad0e-bcd94f557ad0', 'name' => 'Pippa', 'description' => 'Bright, upbeat delivery for helpful guidance, friendly onboarding, and clear everyday support conversations.'],
        ['id' => '5a93ae96-9e3e-4b9d-8575-5f62b7de6d0f', 'name' => 'Imogen', 'description' => 'Polished, articulate delivery for refined support, clear explanations, and calm customer guidance.'],
        ['id' => '1e9b9b3d-d2ce-4cac-9d05-bc36a63fa28e', 'name' => 'Saira', 'description' => 'Warm, attentive delivery for organized, thoughtful follow-up, and approachable service conversations.'],
        ['id' => 'fb02b554-7d64-4f90-841e-e57fc88f410c', 'name' => 'Ailsa', 'description' => 'Calm and personable delivery suited to friendly guidance and calm service interactions.'],
        ['id' => '2f251ac3-89a9-4a77-a452-704b474ccd01', 'name' => 'Lucy', 'description' => 'Reassuring British female for customer assistance.'],
        ['id' => '3c7dfd17-3fa8-47aa-aacc-6313fe025442', 'name' => 'Evelyn', 'description' => 'A clear, neutral, and precise female voice with a smooth digital polish - perfect for virtual-assistant style responses, instructions, and general interactions.'],
        ['id' => 'a01c369f-6d2d-4185-bc20-b32c225eab70', 'name' => 'Fiona', 'description' => 'Chirpy and energetic British female voice with a bright tone, great for lively and engaging conversations'],
        ['id' => '71a7ad14-091c-4e8e-a314-022ece01c121', 'name' => 'Charlotte', 'description' => 'Elegant, young adult female for narrations'],
        ['id' => 'ef191366-f52f-447a-a398-ed8c0f2943a1', 'name' => 'Archie', 'description' => 'Warm, conversational British male for casual and engaging dialogue.'],
        ['id' => 'b24f41fd-00a3-4cd8-992a-a0c9f13f3ef1', 'name' => 'Clive', 'description' => 'Offers a composed and articulate voice, perfect for delivering educational content or detailed advice.'],
        ['id' => '8c254787-4eb4-4577-bd3d-fb3c273baea2', 'name' => 'Rowan', 'description' => 'Provides a reliable and steady vocal presence, ensuring clarity and trust in every piece of communication.'],
        ['id' => '5568a7df-e5ab-4442-9fae-2e9ba1b15ad8', 'name' => 'Quentin', 'description' => 'Polished narrator with a measured pace, perfect for corporate and professional settings'],
        ['id' => '4bc3cb8c-adb9-4bb8-b5d5-cbbef950b991', 'name' => 'George', 'description' => 'Steady, British male voice for capable assistance.'],
        ['id' => 'c8f7835e-28a3-4f0c-80d7-c1302ac62aae', 'name' => 'Alistair', 'description' => 'Sophisticated, steady British male for customer interactions.'],
        ['id' => '0ad65e7f-006c-47cf-bd31-52279d487913', 'name' => 'Rupert', 'description' => 'Warm, mature voice for caring, reassuring conversations'],
        ['id' => 'df89f42f-f285-4613-adbf-14eedcec4c9e', 'name' => 'Harrison', 'description' => 'Crisp, professional British male for efficient customer interactions.'],
        ['id' => '3d5ce2fb-e56c-42f0-9ed9-4662484063b4', 'name' => 'Toby', 'description' => 'Warm, conversational British male with a polished tone.'],
        ['id' => 'dcddf1f4-b114-4b5d-9158-895cbba0e406', 'name' => 'Martin', 'description' => 'A mature, composed delivery offering precise, practical guidance to ensure absolute dependability.'],
        ['id' => 'bb7e8daa-8b79-47a2-8408-a7a1cc72b53c', 'name' => 'Arthur', 'description' => 'Refined and confident tone for formal support and clear customer communication.'],
        ['id' => 'c99d36f3-5ffd-4253-803a-535c1bc9c306', 'name' => 'Griffin', 'description' => 'Elderly male for narrations (Narrator)'],
        ['id' => '15070120-82ab-48e5-87e5-c4bf28fa4bf9', 'name' => 'Finn', 'description' => 'Finn provides an upbeat and amiable listening experience, perfect for presentations or welcoming introductions.'],
        ['id' => '0ea47942-be0b-4bc7-a1bf-5dba008dc1cc', 'name' => 'Owen', 'description' => 'Owen provides precise and efficient support, ideal for navigating services and tech solutions as a support anchor.'],
        ['id' => 'dc52ada6-0e11-4684-a8fa-e0af5b7bdcb2', 'name' => 'Gary', 'description' => 'Measured and direct delivery for no-nonsense conversations.'],
        ['id' => '34d923aa-c3b5-4f21-aac7-2c1f12730d4b', 'name' => 'Griffin (Excited)', 'description' => 'Elderly male for narrations (Excited Narrator)'],
        ['id' => 'd7862948-75c3-4c7c-ae28-2959fe166f49', 'name' => 'Caspian', 'description' => 'Echo-y, mystical male for characters with gravitas'],
        ['id' => '17044048-bfab-44b2-9532-9c1b65e9c217', 'name' => 'Alec', 'description' => 'Lively, warm British male with an upbeat, welcoming energy for sales, product demos, and engaging customer conversations.'],
        ['id' => '22df7143-7987-4e15-a720-d65c69a443b3', 'name' => 'Oscar', 'description' => 'Keen, professional delivery with an energetic undertone for practical guidance, accurate explanations, and professional service conversations.'],
        ['id' => 'f2ddbdca-59d9-4363-abeb-a197d65ea24a', 'name' => 'Roy', 'description' => 'Measured, professional delivery that channels a serious and experienced business attitude into trusted support.'],
        ['id' => '5e7d492a-5502-482e-b315-ebf587427806', 'name' => 'Alfie', 'description' => 'Calm, balanced delivery for thoughtful guidance and professional assistant experiences.'],
        ['id' => '3c0f09d6-e0d7-499c-a594-70c5b7b93048', 'name' => 'Benedict', 'description' => 'Polished, and formal British male. (Measured Mediator)'],
        ['id' => '3faa81ae-d3d8-4ab1-9e44-e50e46d33c30', 'name' => 'Jasper', 'description' => 'Warm, expressive voice for customer support and sales conversations'],
        ['id' => '3bf35adc-bcc4-464b-b834-c90c88cf6492', 'name' => 'Spencer', 'description' => 'Casual voice with an engaging, upbeat tone that feels friendly and effortlessly conversational'],
        ['id' => '1463a4e1-56a1-4b41-b257-728d56e93605', 'name' => 'Hugo', 'description' => 'Expressive, young adult male for characters and natural conversation'],
        ['id' => '4f7f1324-1853-48a6-b294-4e78e8036a83', 'name' => 'Casper', 'description' => 'Wistful, young male for emotional narrations'],
        ['id' => '7cf0e2b1-8daf-4fe4-89ad-f6039398f359', 'name' => 'Benedict (Royal Narrator)', 'description' => 'Confident, firm male for narrations'],
        ['id' => '87748186-23bb-4158-a1eb-332911b0b708', 'name' => 'Alaric', 'description' => 'Wistful, wise, elderly male for entertainment and fun characters'],
        ['id' => 'ee7ea9f8-c0c1-498c-9279-764d6b56d189', 'name' => 'Oliver', 'description' => 'Polite, young adult male for customer facing use cases'],
        ['id' => 'f114a467-c40a-4db8-964d-aaba89cd08fa', 'name' => 'Miles', 'description' => 'Deep, soothing mature male for providing guidance'],
        ['id' => 'c45bc5ec-dc68-4feb-8829-6e6b2748095d', 'name' => 'Trevor', 'description' => 'Deep, elderly male for narrations and entertainment use cases'],
    ],
];
