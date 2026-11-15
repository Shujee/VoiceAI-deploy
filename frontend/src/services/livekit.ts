import { Room, RoomEvent, Track } from 'livekit-client'

export async function connectToLiveKit(
  token: string,
  url: string,
): Promise<Room> {
  const room = new Room()

  // Audio elements are how the browser actually plays what LiveKit
  // receives - track.attach() below hands back a real <audio> element
  // that has to live in the DOM to produce sound, so it can't just be
  // discarded. Tracked here so TrackUnsubscribed/Disconnected below can
  // tear them down again instead of leaving one appended to
  // document.body forever on every connect (that's what the "disabled"
  // orphaned <audio> elements piling up in devtools were - nothing ever
  // removed the previous session's).
  const attachedElements = new Set<HTMLMediaElement>()

  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    console.log(
      '[Browser] Track subscribed:',
      publication.kind,
      publication.trackSid,
      'from',
      participant.identity,
    )

    if (track.kind === Track.Kind.Audio) {
      console.log('[Browser] AUDIO TRACK RECEIVED')
      const element = track.attach()

      element.autoplay = true
      element.controls = true
      element.volume = 1

      document.body.appendChild(element)
      attachedElements.add(element)

      console.log('[Browser] Audio element attached:', element)
    }
  })

  room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
    if (track.kind === Track.Kind.Audio) {
      console.log(
        '[Browser] Audio track unsubscribed, detaching its element(s):',
        publication.trackSid,
        'from',
        participant.identity,
      )

      // detach() stops the track feeding these elements and hands back
      // exactly the ones it was attached to - remove() clears them from
      // the DOM too, since detach() alone doesn't.
      for (const element of track.detach()) {
        element.remove()
        attachedElements.delete(element)
      }
    }
  })

  room.on(RoomEvent.TrackPublished, (publication, participant) => {
    console.log(
      '[Browser] Track published:',
      publication.kind,
      publication.trackSid,
      'from',
      participant.identity,
    )
  })

  room.on(RoomEvent.Disconnected, () => {
    // Belt-and-braces cleanup: catches anything TrackUnsubscribed didn't
    // (e.g. the connection dropping instead of a clean unsubscribe) so no
    // element from this room ever lingers past disconnect.
    for (const element of attachedElements)
      element.remove()

    attachedElements.clear()
  })

  await room.connect(url, token)

  return room
}