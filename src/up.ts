import type { StandardSchemaV1 } from '@standard-schema/spec'
import { fallbackOptions } from './fallback-options'
import type {
   BaseFetchFn,
   DefaultOptions,
   FallbackOptions,
   FetcherOptions,
} from './types'
import {
   isJsonifiable,
   mergeHeaders,
   resolveInput,
   validate,
   withTimeout,
} from './utils'

export function up<
   TFetchFn extends BaseFetchFn,
   TDefaultParsedData = any,
   TDefaultRawBody = Parameters<FallbackOptions['serializeBody']>[0],
>(
   fetchFn: TFetchFn,
   getDefaultOptions: (
      input: Parameters<TFetchFn>[0],
      fetcherOpts: FetcherOptions<TFetchFn, any, any, any>,
      ctx?: Parameters<TFetchFn>[2],
   ) => DefaultOptions<TFetchFn, TDefaultParsedData, TDefaultRawBody> = () => ({}),
) {
   return <
      TParsedData = TDefaultParsedData,
      TSchema extends StandardSchemaV1<
         TParsedData,
         any
      > = StandardSchemaV1<TParsedData>,
      TRawBody = TDefaultRawBody,
   >(
      input: Parameters<TFetchFn>[0],
      fetcherOpts: FetcherOptions<
         TFetchFn,
         TSchema,
         TParsedData,
         TRawBody
      > = emptyOptions,
      ctx?: Parameters<TFetchFn>[2],
   ) => {
      const defaultOpts = getDefaultOptions(input, fetcherOpts, ctx)

      const options = {
         ...fallbackOptions,
         ...defaultOpts,
         ...fetcherOpts,
      }

      if('body' in fetcherOpts) {  
         options.body = fetcherOpts.body === null || fetcherOpts.body === undefined
            ? (fetcherOpts.body as null | undefined)
            : options.serializeBody(fetcherOpts.body)
      }

      options.headers = mergeHeaders([
         isJsonifiable(fetcherOpts.body) && typeof options.body === 'string'
            ? { 'content-type': 'application/json' }
            : {},
         defaultOpts.headers,
         (input as Request).headers,
         fetcherOpts.headers,
      ])

      options.signal = withTimeout(
         options.signal ?? input.signal, 
         options.timeout
      )
      
      const request = new Request(
         resolveInput(
            options.baseUrl,
            input,
            defaultOpts.params,
            fetcherOpts.params,
            options.serializeParams,
         ), 
         options
      )

      defaultOpts.onRequest?.(request)

      return fetchFn(request, options, ctx)
         .catch((error) => {
            defaultOpts.onError?.(error, request)
            throw error
         })
         .then(async (response: Response) => {
            if (!(await options.reject(response))) {
               let parsed: Awaited<TParsedData>
               try {
                  parsed = await options.parseResponse(response, request)
               } catch (error: any) {
                  defaultOpts.onError?.(error, request)
                  throw error
               }
               let data: Awaited<StandardSchemaV1.InferOutput<TSchema>>
               try {
                  data = options.schema
                     ? await validate(options.schema, parsed)
                     : parsed
               } catch (error: any) {
                  defaultOpts.onError?.(error, request)
                  throw error
               }
               defaultOpts.onSuccess?.(data, request)
               return data
            }
            let respError: any
            try {
               respError = await options.parseRejected(response, request)
            } catch (error: any) {
               defaultOpts.onError?.(error, request)
               throw error
            }
            defaultOpts.onError?.(respError, request)
            throw respError
         })
   }
}
