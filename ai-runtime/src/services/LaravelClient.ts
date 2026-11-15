import axios, { AxiosInstance } from 'axios'
import type { BusinessKnowledgeBase } from '../knowledge-base/buildSystemPrompt.js'

export class LaravelClient {
  private http: AxiosInstance

  constructor() {
    this.http = axios.create({
      baseURL: process.env.LARAVEL_URL ?? 'http://backend',
      timeout: 5000,
    })
  }

  async getLiveKitToken(identity: string, room: string): Promise<string> {
    const response = await this.http.post('/api/livekit/token', {
      identity,
      room,
    })

    return response.data.token
  }

  async getBusiness(slug: string): Promise<BusinessKnowledgeBase> {
    const response = await this.http.get(`/api/businesses/${slug}`)

    return response.data
  }

  // Per-call routing lookup (see BusinessController@showByPhone and
  // test-token.ts:beginCall) - `number` is whatever the SIP participant's
  // sip.trunkPhoneNumber attribute carries, unnormalized; the backend
  // normalizes both sides before matching. Same response shape as
  // getBusiness() above (both hit BusinessController@kbPayload), so no
  // separate parsing path is needed. Throws (axios's default on a non-2xx
  // response, e.g. the 404 for an unassigned/inactive number) - the
  // caller is expected to catch this and fall back to getBusiness() with
  // the BUSINESS_SLUG default, same as a KB fetch failure always has.
  async getBusinessByPhone(number: string): Promise<BusinessKnowledgeBase> {
    const response = await this.http.get(
      `/api/businesses/by-phone/${encodeURIComponent(number)}`,
    )

    return response.data
  }
}
