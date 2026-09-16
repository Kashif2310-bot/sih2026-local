export type {
  VoiceAudioChunk,
  VoiceAudioFormat,
  VoiceDiagnosticEvent,
  VoiceErrorEvent,
  VoiceEvent,
  VoiceEventInput,
  VoiceInterruptedEvent,
  VoiceLanguage,
  VoiceModelAudioChunkEvent,
  VoiceModelAudioEndEvent,
  VoiceModelTextFinalEvent,
  VoiceModelTextPartialEvent,
  VoiceProviderId,
  VoiceReplySource,
  VoiceSession,
  VoiceSessionConfig,
  VoiceSessionContext,
  VoiceSessionError,
  VoiceSessionErrorCode,
  VoiceSessionFactory,
  VoiceSessionLanguageConfig,
  VoiceSessionStatus,
  VoiceStatusEvent,
  VoiceTurnEndedEvent,
  VoiceTurnEndReason,
  VoiceTurnPipelineHandler,
  VoiceTurnRole,
  VoiceTurnStartedEvent,
  VoiceUserTranscriptFinalEvent,
  VoiceUserTranscriptPartialEvent,
} from './types'
export {
  createOfflineVoiceSession,
  offlineVoiceSessionFactory,
  OfflineVoiceSession,
  type OfflineVoiceSessionOptions,
} from './offlineVoiceSession'
export {
  createGeminiLiveVoiceSessionFactory,
  geminiLiveVoiceSessionFactory,
  GeminiLiveVoiceSession,
  type GeminiLiveVoiceSessionDeps,
} from './geminiLiveVoiceSession'
export type { GeminiLiveConnectionResolver, GeminiLiveConnectionTarget, GeminiLiveTransport } from './geminiLiveTransport'
export { GEMINI_LIVE_MODEL, GEMINI_LIVE_PROXY_URL, isGeminiLiveConfigured } from './geminiLiveConfig'
export {
  GEMINI_LIVE_INPUT_AUDIO_MIME_TYPE,
  GEMINI_LIVE_INPUT_SAMPLE_RATE_HZ,
  GEMINI_LIVE_OUTPUT_AUDIO_MIME_TYPE,
  GEMINI_LIVE_OUTPUT_SAMPLE_RATE_HZ,
} from './geminiLiveProtocol'
// Deliberately NOT exported here: FakeGeminiLiveTransport
// (testing/fakeGeminiLiveTransport.ts) is test-only — import it directly
// from its own path in a test file, never through this barrel.
