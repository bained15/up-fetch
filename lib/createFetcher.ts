import { buildOptions } from './buildOptions.js'
import { ResponseError } from './ResponseError.js'

// Aliasing Record<string, any> to PlainObject for clearer intent
type PlainObject = Record<string, any>

export type FetchLike<Init extends Record<string, any> = RequestInit> = (
   url: any,
   init?: Init,
) => Promise<Response>

export interface SharedOptions<D = any> extends Omit<RequestInit, 'body' | 'method'> {
   baseUrl?: string
   method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'CONNECT' | 'OPTIONS' | 'TRACE' | 'HEAD'
   parseSuccess?: (response: Response, options: RequestOptions) => Promise<D> | D
   parseError?: (response: Response, options: RequestOptions) => Promise<any> | any
   retryTimes?: number
   retryWhen?: (response: Response, options: RequestOptions) => boolean
   retryDelay?: (attemptNumber: number, response: Response) => number
   serializeBody?: (body: PlainObject | Array<any>) => string
   serializeParams?: (params: Record<string, any>) => string
}

export interface DefaultOptions<D = any> extends SharedOptions<D> {
   onError?: (error: ResponseError) => void
   beforeFetch?: (options: RequestOptions) => void
   onSuccess?: (data: any, options: RequestOptions) => void
}

export interface FetcherOptions<D = any> extends SharedOptions<D> {
   url?: string
   params?: string | Record<string, any>
   body?: BodyInit | PlainObject | Array<any> | null
}

type RequestOptionsRequiredKeys =
   | 'parseError'
   | 'parseSuccess'
   | 'retryDelay'
   | 'retryWhen'
   | 'serializeBody'
   | 'serializeParams'
   | 'headers'

export interface RequestOptions<DD = any, D = DD>
   extends Omit<RequestInit, RequestOptionsRequiredKeys>,
      Omit<DefaultOptions<DD>, RequestOptionsRequiredKeys | keyof RequestInit>,
      Omit<FetcherOptions<D>, RequestOptionsRequiredKeys | keyof RequestInit>,
      Pick<Required<SharedOptions>, RequestOptionsRequiredKeys> {
   headers: Headers
   href: string
}

export let createFetcher =
   <DD = any>(defaultOptions?: () => DefaultOptions<DD>, fetchFn: FetchLike = fetch) =>
   <D = DD>(fetcherOptions?: FetcherOptions<D>) => {
      let options = buildOptions<DD, D>(defaultOptions?.(), fetcherOptions)

      options.beforeFetch?.(options)

      return withRetry(fetchFn)(options.href, options)
         .then(async (res) => {
            if (res.ok) {
               let data = (await options.parseSuccess(res, options)) as D
               options.onSuccess?.(data, options)
               return data
            } else {
               throw await options.parseError(res, options)
            }
         })
         .catch((error) => {
            options.onError?.(error)
            throw error
         })
   }

let waitFor = (ms = 0, signal?: AbortSignal | null) =>
   new Promise<void>((resolve, reject) => {
      let timeoutId = setTimeout(timeoutCb, ms)
      function abortCb() {
         clearTimeout(timeoutId)
         reject(new DOMException('Request cancelled.', 'AbortError'))
      }
      function timeoutCb() {
         signal?.removeEventListener('abort', abortCb)
         resolve()
      }
      signal?.addEventListener('abort', abortCb)
   })

export let withRetry = <F extends FetchLike>(fetchFn: F) =>
   async function fetcher(url: string, opts: RequestOptions, count = 0): Promise<Response> {
      let res = await fetchFn(url, opts)
      return res.ok || count === (opts.retryTimes || 0) || !opts.retryWhen(res, opts)
         ? res
         : waitFor(opts.retryDelay(++count, res), opts.signal).then(() => fetcher(url, opts, count))
   }

// createFetcher(() => ({}))({
//    baseUrl: '',
//    url: '',
//    params: '',
//    body: '',
//    method: 'GET',
//    serializeParams: () => '',
//    serializeBody: () => '',
// })
