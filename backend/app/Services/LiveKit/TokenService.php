<?php

namespace App\Services\LiveKit;

use Agence104\LiveKit\AccessToken;
use Agence104\LiveKit\AccessTokenOptions;
use Agence104\LiveKit\VideoGrant;

class TokenService
{

  public function create(string $identity, string $room): string
  {
    $options = (new AccessTokenOptions())
      ->setIdentity($identity);

    $grant = (new VideoGrant())
      ->setRoomJoin()
      ->setRoomName($room);

    return (new AccessToken(
      env('LIVEKIT_API_KEY'),
      env('LIVEKIT_API_SECRET')
    ))
      ->init($options)
      ->setGrant($grant)
      ->toJwt();
  }
}
