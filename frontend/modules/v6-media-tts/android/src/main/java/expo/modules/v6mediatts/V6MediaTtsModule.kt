package expo.modules.v6mediatts

import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.Locale
import java.util.UUID
import android.util.Base64

class V6MediaTtsModule : Module() {
  private var textToSpeech: TextToSpeech? = null
  private var isReady = false
  private val preparePromises = mutableListOf<Promise>()
  private val speechPromises = mutableMapOf<String, Promise>()

  private var mediaRecorder: MediaRecorder? = null
  private var isRecording = false
  private var mediaPlayer: MediaPlayer? = null
  private var isPlaying = false
  private var audioFocusGranted = false
  private var audioFocusRequest: AudioFocusRequest? = null
  private var audioDeviceCallback: android.media.AudioDeviceCallback? = null
  // ponytail: legacy API 25 listener, abandon with abandonAudioFocus()
  @Suppress("DEPRECATION")
  private val legacyFocusListener = AudioManager.OnAudioFocusChangeListener { }
  private var recordingStartedAt = 0L
  private var lastRoute: String? = null

  private var freeMediaRecorder: MediaRecorder? = null
  private var isFreeRecording = false
  private var freeRecordingStartedAt = 0L
  private var freeRecordingFile: File? = null

  private var streamCaptureThread: Thread? = null
  private var streamAudioRecord: AudioRecord? = null
  @Volatile private var captureMuted = false
  @Volatile private var captureRunning = false
  private var streamAudioTrack: AudioTrack? = null
  private var streamBytesWritten = 0L
  private var streamFirstChunkSent = false

  private val audioManager: AudioManager?
    get() = appContext.reactContext?.getSystemService(AudioManager::class.java)

  override fun definition() = ModuleDefinition {
    Name("V6MediaTts")
    Events("onSpeechStart", "onSpeechDone", "onSpeechError", "onRecordingStop", "onFreeRecordingStop", "onPlaybackStart", "onPlaybackStop", "onRouteChange", "onAudioChunk", "onStreamFirstAudio", "onStreamPlaybackStop")

    OnCreate {
      val context = appContext.reactContext ?: return@OnCreate
      textToSpeech = TextToSpeech(context.applicationContext) { status ->
        if (status == TextToSpeech.SUCCESS) {
          val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
          textToSpeech?.setAudioAttributes(attributes)
          textToSpeech?.setOnUtteranceProgressListener(progressListener)
          isReady = true
          preparePromises.toList().forEach { it.resolve(snapshotMediaContract()) }
        } else {
          preparePromises.toList().forEach {
            it.reject("TTS_INIT_FAILED", "O mecanismo de voz do Android não foi inicializado.", null)
          }
        }
        preparePromises.clear()
      }

      audioDeviceCallback = object : android.media.AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
          sendRouteChangeEvent()
        }
        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
          sendRouteChangeEvent()
        }
      }
      audioManager?.registerAudioDeviceCallback(audioDeviceCallback, Handler(Looper.getMainLooper()))
      // Fix #5: initialize lastRoute with current output
      val outputs = audioManager?.getDevices(AudioManager.GET_DEVICES_OUTPUTS) ?: emptyArray()
      val initialOutput = outputs.firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP
        || it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
        || it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
      lastRoute = initialOutput?.productName?.toString() ?: "desconhecido"
    }

    OnDestroy {
      textToSpeech?.stop()
      textToSpeech?.shutdown()
      textToSpeech = null
      isReady = false
      speechPromises.clear()

      audioDeviceCallback?.let { audioManager?.unregisterAudioDeviceCallback(it) }
      audioDeviceCallback = null
      stopRecordingInternal()
      stopFreeRecordingInternal()
      stopPlaybackInternal()
      stopStreamCaptureInternal()
      stopStreamPlaybackInternal()
    }

    OnActivityEntersBackground {
      if (isRecording) {
        val file = File(appContext.reactContext?.cacheDir ?: return@OnActivityEntersBackground, "fase2-teste.m4a")
        stopRecordingInternal()
        if (file.exists()) file.delete()
      }
      if (captureRunning) {
        stopStreamCaptureInternal()
      }
      if (streamAudioTrack != null) {
        stopStreamPlaybackInternal()
      }
    }

    AsyncFunction("prepare") { promise: Promise ->
      if (isReady) {
        promise.resolve(snapshotMediaContract())
      } else {
        preparePromises.add(promise)
      }
    }

    AsyncFunction("speak") { text: String, languageTag: String, promise: Promise ->
      if (!isReady || textToSpeech == null) {
        promise.reject("TTS_NOT_READY", "O mecanismo de voz ainda está iniciando.", null)
      } else {
        val utteranceId = UUID.randomUUID().toString()
        val parameters = Bundle().apply {
          // Explicitly keep the Android TTS utterance on the media stream.
          putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC)
        }
        textToSpeech?.language = Locale.forLanguageTag(languageTag)
        val result = textToSpeech?.speak(text, TextToSpeech.QUEUE_FLUSH, parameters, utteranceId)
        if (result == TextToSpeech.SUCCESS) {
          speechPromises[utteranceId] = promise
        } else {
          promise.reject("TTS_SPEAK_FAILED", "O Android não conseguiu iniciar a reprodução.", null)
        }
      }
    }

    AsyncFunction("stop") {
      textToSpeech?.stop()
      speechPromises.toMap().forEach { (_, promise) ->
        promise.reject("TTS_STOPPED", "Reprodução interrompida pelo usuário.", null)
      }
      speechPromises.clear()
    }

    AsyncFunction("getAudioSnapshot") {
      snapshotAudio()
    }

    AsyncFunction("startRecording") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("NO_CONTEXT", "Contexto Android indisponível.", null)
        return@AsyncFunction
      }
      if (isRecording) {
        promise.reject("ALREADY_RECORDING", "Gravação já em andamento.", null)
        return@AsyncFunction
      }
      if (isPlaying) {
        stopPlaybackInternal()
      }
      try {
        val file = File(context.cacheDir, "fase2-teste.m4a")
        if (file.exists()) file.delete()

        val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          MediaRecorder(context)
        } else {
          @Suppress("DEPRECATION")
          MediaRecorder()
        }

        recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
        recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        recorder.setMaxDuration(5000)
        recorder.setOutputFile(file.absolutePath)

        recorder.setOnInfoListener { _, what, _ ->
          if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED) {
            finishRecording()
          }
        }

        val inputs = audioManager?.getDevices(AudioManager.GET_DEVICES_INPUTS) ?: emptyArray()
        val builtInMic = inputs.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_MIC }
        if (builtInMic != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          recorder.setPreferredDevice(builtInMic)
        }

        recorder.prepare()
        recorder.start()
        mediaRecorder = recorder
        isRecording = true
        recordingStartedAt = System.currentTimeMillis()

        val outputs = audioManager?.getDevices(AudioManager.GET_DEVICES_OUTPUTS) ?: emptyArray()
        val inputList = inputs.map { "${deviceTypeName(it.type)}:${it.productName}" }
        val outputList = outputs.map { "${deviceTypeName(it.type)}:${it.productName}" }

        val routedInput = try {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            recorder.routedDevice?.productName?.toString() ?: "indisponível"
          } else "indisponível"
        } catch (_: Exception) { "indisponível" }

        promise.resolve(mapOf(
          "mode" to modeLabel(audioManager?.mode ?: AudioManager.MODE_NORMAL),
          "inputs" to inputList,
          "outputs" to outputList,
          "scoActive" to (audioManager?.isBluetoothScoOn == true),
          "routedInput" to routedInput,
          "builtInMicFound" to (builtInMic != null)
        ))
      } catch (e: Exception) {
        promise.reject("RECORD_FAILED", "Falha ao iniciar gravação: ${e.message}", null)
      }
    }

    AsyncFunction("stopRecording") { promise: Promise ->
      if (!isRecording) {
        promise.reject("NOT_RECORDING", "Nenhuma gravação em andamento.", null)
        return@AsyncFunction
      }
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("NO_CONTEXT", "Contexto Android indisponível.", null)
        return@AsyncFunction
      }
      finishRecording()
      promise.resolve(null)
    }

    AsyncFunction("startPlayback") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("NO_CONTEXT", "Contexto Android indisponível.", null)
        return@AsyncFunction
      }
      if (isPlaying) {
        promise.reject("ALREADY_PLAYING", "Reprodução já em andamento.", null)
        return@AsyncFunction
      }
      if (isRecording) {
        promise.reject("RECORDING_ACTIVE", "Pare a gravação antes de reproduzir.", null)
        return@AsyncFunction
      }
      val file = File(context.cacheDir, "fase2-teste.m4a")
      if (!file.exists()) {
        promise.reject("NO_FILE", "Nenhuma gravação encontrada.", null)
        return@AsyncFunction
      }

      val manager = audioManager
      val focusResult = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val attrs = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
          .setAudioAttributes(attrs)
          .build()
        audioFocusRequest = request
        manager?.requestAudioFocus(request) ?: AudioManager.AUDIOFOCUS_REQUEST_FAILED
      } else {
        @Suppress("DEPRECATION")
        manager?.requestAudioFocus(
          legacyFocusListener,
          AudioManager.STREAM_MUSIC,
          AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
        ) ?: AudioManager.AUDIOFOCUS_REQUEST_FAILED
      }

      audioFocusGranted = focusResult == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
      if (!audioFocusGranted) {
        promise.reject("FOCUS_DENIED", "Foco de áudio negado.", null)
        return@AsyncFunction
      }

      try {
        val player = MediaPlayer()
        val attrs = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
        player.setAudioAttributes(attrs)
        player.setDataSource(file.absolutePath)
        player.setOnPreparedListener {
          isPlaying = true
          sendEvent("onPlaybackStart", mapOf("time" to System.currentTimeMillis()))
          it.start()
        }
        player.setOnCompletionListener {
          sendEvent("onPlaybackStop", mapOf("time" to System.currentTimeMillis()))
          stopPlaybackInternal()
        }
        player.setOnErrorListener { _, _, _ ->
          stopPlaybackInternal()
          false
        }
        player.prepareAsync()
        mediaPlayer = player

        val outputs = manager?.getDevices(AudioManager.GET_DEVICES_OUTPUTS) ?: emptyArray()
        val outputList = outputs.map { "${deviceTypeName(it.type)}:${it.productName}" }
        promise.resolve(mapOf(
          "mode" to modeLabel(manager?.mode ?: AudioManager.MODE_NORMAL),
          "outputs" to outputList,
          "usage" to "USAGE_MEDIA",
          "contentType" to "CONTENT_TYPE_SPEECH",
          "focus" to "concedido"
        ))
      } catch (e: Exception) {
        abandonAudioFocus()
        promise.reject("PLAYBACK_FAILED", "Falha ao iniciar reprodução: ${e.message}", null)
      }
    }

    AsyncFunction("stopPlayback") { promise: Promise ->
      if (!isPlaying) {
        promise.reject("NOT_PLAYING", "Nenhuma reprodução em andamento.", null)
        return@AsyncFunction
      }
      stopPlaybackInternal()
      promise.resolve(null)
    }

    AsyncFunction("startFreeRecording") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("NO_CONTEXT", "Contexto Android indisponível.", null)
        return@AsyncFunction
      }
      if (isFreeRecording) {
        promise.reject("ALREADY_RECORDING", "Gravação livre já em andamento.", null)
        return@AsyncFunction
      }
      if (isPlaying) {
        stopPlaybackInternal()
      }
      try {
        val file = File(context.cacheDir, "fase3-livre.m4a")
        if (file.exists()) file.delete()

        val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          MediaRecorder(context)
        } else {
          @Suppress("DEPRECATION")
          MediaRecorder()
        }

        recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
        recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        recorder.setOutputFile(file.absolutePath)

        val inputs = audioManager?.getDevices(AudioManager.GET_DEVICES_INPUTS) ?: emptyArray()
        val builtInMic = inputs.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_MIC }
        if (builtInMic != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          recorder.setPreferredDevice(builtInMic)
        }

        recorder.prepare()
        recorder.start()
        freeMediaRecorder = recorder
        isFreeRecording = true
        freeRecordingStartedAt = System.currentTimeMillis()
        freeRecordingFile = file

        val outputs = audioManager?.getDevices(AudioManager.GET_DEVICES_OUTPUTS) ?: emptyArray()
        val inputList = inputs.map { "${deviceTypeName(it.type)}:${it.productName}" }
        val outputList = outputs.map { "${deviceTypeName(it.type)}:${it.productName}" }

        val routedInput = try {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            recorder.routedDevice?.productName?.toString() ?: "indisponível"
          } else "indisponível"
        } catch (_: Exception) { "indisponível" }

        promise.resolve(mapOf(
          "mode" to modeLabel(audioManager?.mode ?: AudioManager.MODE_NORMAL),
          "inputs" to inputList,
          "outputs" to outputList,
          "routedInput" to routedInput,
          "builtInMicFound" to (builtInMic != null)
        ))
      } catch (e: Exception) {
        promise.reject("RECORD_FAILED", "Falha ao iniciar gravação livre: ${e.message}", null)
      }
    }

    AsyncFunction("stopFreeRecording") { promise: Promise ->
      if (!isFreeRecording) {
        promise.reject("NOT_RECORDING", "Nenhuma gravação livre em andamento.", null)
        return@AsyncFunction
      }
      val durationMs = System.currentTimeMillis() - freeRecordingStartedAt
      val file = freeRecordingFile
      try {
        freeMediaRecorder?.stop()
      } catch (_: Exception) {}
      try { freeMediaRecorder?.release() } catch (_: Exception) {}
      freeMediaRecorder = null
      isFreeRecording = false

      val path = file?.absolutePath ?: ""
      val bytes = if (file?.exists() == true) file.length() else 0L
      sendEvent("onFreeRecordingStop", mapOf(
        "path" to path,
        "bytes" to bytes,
        "durationMs" to durationMs,
        "mode" to modeLabel(audioManager?.mode ?: AudioManager.MODE_NORMAL),
        "outputs" to emptyList<String>()
      ))
      promise.resolve(mapOf(
        "path" to path,
        "bytes" to bytes,
        "durationMs" to durationMs
      ))
    }

    AsyncFunction("playFile") { path: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("NO_CONTEXT", "Contexto Android indisponível.", null)
        return@AsyncFunction
      }
      if (isPlaying) {
        stopPlaybackInternal()
      }
      val file = File(path)
      if (!file.exists()) {
        promise.reject("FILE_NOT_FOUND", "Arquivo de áudio não encontrado: $path", null)
        return@AsyncFunction
      }

      val settled = java.util.concurrent.atomic.AtomicBoolean(false)
      val manager = audioManager
      val focusResult = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val attrs = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
          .setAudioAttributes(attrs)
          .build()
        audioFocusRequest = request
        manager?.requestAudioFocus(request) ?: AudioManager.AUDIOFOCUS_REQUEST_FAILED
      } else {
        @Suppress("DEPRECATION")
        manager?.requestAudioFocus(
          legacyFocusListener,
          AudioManager.STREAM_MUSIC,
          AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
        ) ?: AudioManager.AUDIOFOCUS_REQUEST_FAILED
      }

      audioFocusGranted = focusResult == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
      if (!audioFocusGranted) {
        promise.reject("FOCUS_DENIED", "Foco de áudio negado.", null)
        return@AsyncFunction
      }

      try {
        val player = MediaPlayer()
        val attrs = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
        player.setAudioAttributes(attrs)
        player.setDataSource(file.absolutePath)
        player.setOnPreparedListener {
          isPlaying = true
          sendEvent("onPlaybackStart", mapOf("time" to System.currentTimeMillis()))
          it.start()
        }
        player.setOnCompletionListener {
          sendEvent("onPlaybackStop", mapOf("time" to System.currentTimeMillis()))
          stopPlaybackInternal()
          if (settled.compareAndSet(false, true)) promise.resolve(null)
        }
        player.setOnErrorListener { _, _, _ ->
          stopPlaybackInternal()
          if (settled.compareAndSet(false, true)) promise.reject("PLAYBACK_FAILED", "Erro na reprodução.", null)
          false
        }
        player.prepareAsync()
        mediaPlayer = player

        val handler = Handler(Looper.getMainLooper())
        val timeoutRunnable = Runnable {
          if (isPlaying && settled.compareAndSet(false, true)) {
            stopPlaybackInternal()
            promise.reject("PLAYBACK_TIMEOUT", "Reprodução excedeu 30s.", null)
          }
        }
        handler.postDelayed(timeoutRunnable, 30_000)

        // ponytail: promise resolve moved to onCompletionListener
      } catch (e: Exception) {
        abandonAudioFocus()
        promise.reject("PLAYBACK_FAILED", "Falha ao reproduzir arquivo: ${e.message}", null)
      }
    }

    AsyncFunction("saveBase64ToCache") { base64: String, name: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("NO_CONTEXT", "Contexto Android indisponível.", null)
        return@AsyncFunction
      }
      try {
        val bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
        val file = File(context.cacheDir, name)
        file.writeBytes(bytes)
        promise.resolve(file.absolutePath)
      } catch (e: Exception) {
        promise.reject("SAVE_FAILED", "Falha ao salvar áudio: ${e.message}", null)
      }
    }

    AsyncFunction("startStreamCapture") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("NO_CONTEXT", "Contexto Android indisponível.", null)
        return@AsyncFunction
      }
      if (captureRunning) {
        promise.reject("ALREADY_CAPTURING", "Captura de áudio já em andamento.", null)
        return@AsyncFunction
      }
      val sampleRate = 24000
      val channelConfig = AudioFormat.CHANNEL_IN_MONO
      val audioFormat = AudioFormat.ENCODING_PCM_16BIT
      val minBuf = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)
      val bufferSize = maxOf(minBuf, sampleRate * 2 / 10)
      try {
        val recorder = AudioRecord.Builder()
          .setAudioSource(MediaRecorder.AudioSource.MIC)
          .setAudioFormat(
            AudioFormat.Builder()
              .setSampleRate(sampleRate)
              .setChannelMask(channelConfig)
              .setEncoding(audioFormat)
              .build()
          )
          .setBufferSizeInBytes(bufferSize)
          .build()
        val inputs = audioManager?.getDevices(AudioManager.GET_DEVICES_INPUTS) ?: emptyArray()
        val builtInMic = inputs.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_MIC }
        if (builtInMic != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          recorder.setPreferredDevice(builtInMic)
        }
        streamAudioRecord = recorder
        captureRunning = true
        captureMuted = false
        recorder.startRecording()
        val routedInput = try {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            recorder.routedDevice?.productName?.toString() ?: "indisponível"
          } else "indisponível"
        } catch (_: Exception) { "indisponível" }
        val thread = Thread({
          val buf = ByteArray(bufferSize)
          while (captureRunning) {
            val read = recorder.read(buf, 0, buf.size)
            if (read > 0 && captureRunning && !captureMuted) {
              val chunk = Base64.encodeToString(buf.copyOf(read), Base64.NO_WRAP)
              sendEvent("onAudioChunk", mapOf("base64" to chunk))
            }
          }
        }, "v6-stream-capture")
        thread.start()
        streamCaptureThread = thread
        promise.resolve(mapOf(
          "sampleRate" to sampleRate,
          "bufferBytes" to bufferSize,
          "routedInput" to routedInput,
          "mode" to modeLabel(audioManager?.mode ?: AudioManager.MODE_NORMAL)
        ))
      } catch (e: Exception) {
        captureRunning = false
        streamAudioRecord?.release()
        streamAudioRecord = null
        promise.reject("CAPTURE_FAILED", "Falha ao iniciar captura de áudio: ${e.message}", null)
      }
    }

    AsyncFunction("stopStreamCapture") { promise: Promise ->
      stopStreamCaptureInternal()
      promise.resolve(null)
    }

    AsyncFunction("setCaptureMuted") { muted: Boolean, promise: Promise ->
      captureMuted = muted
      promise.resolve(null)
    }

    AsyncFunction("startStreamPlayback") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("NO_CONTEXT", "Contexto Android indisponível.", null)
        return@AsyncFunction
      }
      if (streamAudioTrack != null) {
        promise.reject("ALREADY_PLAYING", "Reprodução em fluxo já em andamento.", null)
        return@AsyncFunction
      }
      val sampleRate = 24000
      val channelConfig = AudioFormat.CHANNEL_OUT_MONO
      val audioFormat = AudioFormat.ENCODING_PCM_16BIT
      val minBuf = AudioTrack.getMinBufferSize(sampleRate, channelConfig, audioFormat)
      val bufferSize = maxOf(minBuf, sampleRate * 2 / 10)
      val manager = audioManager
      val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()
      val focusResult = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
          .setAudioAttributes(attrs)
          .build()
        audioFocusRequest = request
        manager?.requestAudioFocus(request) ?: AudioManager.AUDIOFOCUS_REQUEST_FAILED
      } else {
        @Suppress("DEPRECATION")
        manager?.requestAudioFocus(
          legacyFocusListener,
          AudioManager.STREAM_MUSIC,
          AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
        ) ?: AudioManager.AUDIOFOCUS_REQUEST_FAILED
      }
      audioFocusGranted = focusResult == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
      if (!audioFocusGranted) {
        promise.reject("FOCUS_DENIED", "Foco de áudio negado.", null)
        return@AsyncFunction
      }
      try {
        val track = AudioTrack.Builder()
          .setAudioAttributes(attrs)
          .setAudioFormat(
            AudioFormat.Builder()
              .setSampleRate(sampleRate)
              .setChannelMask(channelConfig)
              .setEncoding(audioFormat)
              .build()
          )
          .setBufferSizeInBytes(bufferSize)
          .setTransferMode(AudioTrack.MODE_STREAM)
          .build()
        streamAudioTrack = track
        streamBytesWritten = 0
        streamFirstChunkSent = false
        val outputs = manager?.getDevices(AudioManager.GET_DEVICES_OUTPUTS) ?: emptyArray()
        val outputList = outputs.map { "${deviceTypeName(it.type)}:${it.productName}" }
        promise.resolve(mapOf(
          "sampleRate" to sampleRate,
          "bufferBytes" to bufferSize,
          "outputs" to outputList
        ))
      } catch (e: Exception) {
        abandonAudioFocus()
        promise.reject("PLAYBACK_FAILED", "Falha ao iniciar reprodução em fluxo: ${e.message}", null)
      }
    }

    AsyncFunction("writeStreamChunk") { base64: String, promise: Promise ->
      val track = streamAudioTrack
      if (track == null) {
        promise.reject("NOT_PLAYING", "Nenhuma reprodução em fluxo ativa.", null)
        return@AsyncFunction
      }
      try {
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        if (!streamFirstChunkSent) {
          streamFirstChunkSent = true
          track.play()
          sendEvent("onStreamFirstAudio", mapOf("time" to System.currentTimeMillis()))
        }
        track.write(bytes, 0, bytes.size)
        streamBytesWritten += bytes.size
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("WRITE_FAILED", "Falha ao escrever áudio: ${e.message}", null)
      }
    }

    AsyncFunction("stopStreamPlayback") { promise: Promise ->
      stopStreamPlaybackInternal()
      promise.resolve(null)
    }
  }

  private val progressListener = object : UtteranceProgressListener() {
    override fun onStart(utteranceId: String) {
      sendEvent("onSpeechStart", mapOf("utteranceId" to utteranceId))
    }

    override fun onDone(utteranceId: String) {
      sendEvent("onSpeechDone", mapOf("utteranceId" to utteranceId))
      speechPromises.remove(utteranceId)?.resolve(null)
    }

    @Deprecated("Required by Android TextToSpeech")
    override fun onError(utteranceId: String) {
      sendEvent("onSpeechError", mapOf("utteranceId" to utteranceId))
      speechPromises.remove(utteranceId)?.reject("TTS_ERROR", "O Android relatou um erro de síntese.", null)
    }
  }

  private fun snapshotMediaContract() = mapOf(
    "usage" to "USAGE_MEDIA",
    "contentType" to "CONTENT_TYPE_SPEECH",
    "stream" to "STREAM_MUSIC",
    "communicationModeRequested" to false,
    "scoRequested" to false
  )

  private fun snapshotAudio(): Map<String, Any?> {
    val manager = audioManager ?: return mapOf("available" to false, "reason" to "AudioManager indisponível")
    return try {
      val outputs = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).toList()
      } else emptyList()
      val bluetooth = outputs.firstOrNull { isBluetoothType(it.type) }
      mapOf(
        "available" to true,
        "bluetoothConnected" to (bluetooth != null),
        "deviceName" to (bluetooth?.productName?.toString()?.takeIf { it.isNotBlank() } ?: "Nome não disponível"),
        "routeType" to if (bluetooth != null) "Bluetooth" else "Speaker / outro",
        "audioMode" to modeLabel(manager.mode),
        "audioModeCode" to manager.mode,
        "scoActive" to manager.isBluetoothScoOn,
        "mediaActive" to manager.isMusicActive,
        "outputCount" to outputs.size
      )
    } catch (securityException: SecurityException) {
      mapOf("available" to false, "reason" to "Permissão Bluetooth necessária")
    }
  }

  private fun isBluetoothType(type: Int): Boolean = type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
    type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
    (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP)

  private fun modeLabel(mode: Int): String = when (mode) {
    AudioManager.MODE_NORMAL -> "MODE_NORMAL"
    AudioManager.MODE_RINGTONE -> "MODE_RINGTONE"
    AudioManager.MODE_IN_CALL -> "MODE_IN_CALL"
    AudioManager.MODE_IN_COMMUNICATION -> "MODE_IN_COMMUNICATION"
    else -> "MODE_$mode"
  }

  private fun deviceTypeName(type: Int): String = when (type) {
    AudioDeviceInfo.TYPE_BUILTIN_MIC -> "BUILTIN_MIC"
    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "BUILTIN_SPEAKER"
    AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "BUILTIN_EARPIECE"
    AudioDeviceInfo.TYPE_WIRED_HEADSET -> "WIRED_HEADSET"
    AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "WIRED_HEADPHONES"
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "BT_SCO"
    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "BT_A2DP"
    AudioDeviceInfo.TYPE_USB_DEVICE -> "USB_DEVICE"
    AudioDeviceInfo.TYPE_USB_HEADSET -> "USB_HEADSET"
    else -> "TYPE_$type"
  }

  private fun stopRecordingInternal() {
    if (!isRecording) return
    try {
      mediaRecorder?.stop()
    } catch (_: Exception) {
      val file = File(appContext.reactContext?.cacheDir ?: return, "fase2-teste.m4a")
      if (file.exists()) file.delete()
    } finally {
      try { mediaRecorder?.release() } catch (_: Exception) {}
      mediaRecorder = null
      isRecording = false
    }
  }

  private fun stopFreeRecordingInternal() {
    if (!isFreeRecording) return
    try {
      freeMediaRecorder?.stop()
    } catch (_: Exception) {}
    try { freeMediaRecorder?.release() } catch (_: Exception) {}
    freeMediaRecorder = null
    isFreeRecording = false
    freeRecordingFile = null
  }

  private fun finishRecording() {
    if (!isRecording) return
    val durationMs = System.currentTimeMillis() - recordingStartedAt
    val file = File(appContext.reactContext?.cacheDir ?: return, "fase2-teste.m4a")
    stopRecordingInternal()
    val bytes = if (file.exists()) file.length() else 0L
    val outputs = audioManager?.getDevices(AudioManager.GET_DEVICES_OUTPUTS) ?: emptyArray()
    val outputList = outputs.map { "${deviceTypeName(it.type)}:${it.productName}" }
    sendEvent("onRecordingStop", mapOf(
      "path" to file.absolutePath,
      "bytes" to bytes,
      "durationMs" to durationMs,
      "mode" to modeLabel(audioManager?.mode ?: AudioManager.MODE_NORMAL),
      "outputs" to outputList
    ))
  }

  private fun stopPlaybackInternal() {
    try {
      mediaPlayer?.stop()
      mediaPlayer?.reset()
      mediaPlayer?.release()
    } catch (_: Exception) {}
    mediaPlayer = null
    isPlaying = false
    abandonAudioFocus()
  }

  private fun abandonAudioFocus() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      audioFocusRequest?.let { audioManager?.abandonAudioFocusRequest(it) }
    } else {
      @Suppress("DEPRECATION")
      audioManager?.abandonAudioFocus(legacyFocusListener)
    }
    audioFocusGranted = false
    audioFocusRequest = null
  }

  private fun stopStreamCaptureInternal() {
    captureRunning = false
    try {
      streamCaptureThread?.join(500)
    } catch (_: InterruptedException) {}
    streamCaptureThread = null
    try {
      streamAudioRecord?.stop()
    } catch (_: Exception) {}
    try {
      streamAudioRecord?.release()
    } catch (_: Exception) {}
    streamAudioRecord = null
  }

  private fun stopStreamPlaybackInternal() {
    val track = streamAudioTrack ?: return
    try {
      track.pause()
      track.flush()
      track.stop()
      track.release()
    } catch (_: Exception) {}
    streamAudioTrack = null
    streamBytesWritten = 0
    streamFirstChunkSent = false
    abandonAudioFocus()
    sendEvent("onStreamPlaybackStop", mapOf("time" to System.currentTimeMillis()))
  }

  private fun sendRouteChangeEvent() {
    val manager = audioManager ?: return
    val outputs = manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
    val currentOutput = outputs.firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP
      || it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
      || it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
    val currentName = currentOutput?.productName?.toString() ?: "desconhecido"
    if (currentName == lastRoute) return
    val before = lastRoute ?: "desconhecido"
    lastRoute = currentName
    sendEvent("onRouteChange", mapOf(
      "before" to before,
      "after" to currentName,
      "time" to System.currentTimeMillis()
    ))
  }
}