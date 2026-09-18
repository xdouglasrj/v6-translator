package expo.modules.escutaaudio

import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

private data class AudioQueueItem(
  val base64: String,
  val formato: String,
  val promise: Promise,
  val arquivo: File
)

class EscutaAudioModule : Module() {
  private var textToSpeech: TextToSpeech? = null
  private var isTtsReady = false
  private val ttsInitPromises = mutableListOf<Promise>()
  private val speechPromises = mutableMapOf<String, Promise>()

  private var audioRecord: AudioRecord? = null
  private var captureThread: Thread? = null
  private val isCapturing = AtomicBoolean(false)
  private val isMuted = AtomicBoolean(false)
  private var communicationDevice: AudioDeviceInfo? = null

  private var mediaPlayer: MediaPlayer? = null
  private val audioQueue = ConcurrentLinkedQueue<AudioQueueItem>()
  private var tocandoAudio = false

  @Volatile private var voiceThreshold = 1500
  private val msParaComecar = 150
  private val msDeSilencioParaEncerrar = 900
  private val msMinimoDeFala = 400
  private val msMaximoDeFala = 15000

  private val sampleRate = 16000
  private val channelConfig = AudioFormat.CHANNEL_IN_MONO
  private val audioFormat = AudioFormat.ENCODING_PCM_16BIT
  private val frameSizeMs = 20
  private val samplesPerFrame = sampleRate * frameSizeMs / 1000
  private val bytesPerFrame = samplesPerFrame * 2

  private val circularBufferSizeMs = 300
  private val circularBufferFrames = circularBufferSizeMs / frameSizeMs
  private val circularBuffer = Array(circularBufferFrames) { ByteArray(bytesPerFrame) }
  private var circularWriteIndex = 0
  private var circularFramesFilled = 0

  private var speechFrames = mutableListOf<ByteArray>()
  private var speechStartTime = 0L
  private var speechDurationMs = 0
  private var aboveThresholdMs = 0
  private var silenceMs = 0
  private var inSpeech = false
  private var lastNivelEventTime = 0L

  private val audioManager: AudioManager?
    get() = appContext.reactContext?.getSystemService(AudioManager::class.java)

  override fun definition() = ModuleDefinition {
    Name("EscutaAudio")
    Events("onFalaPronta", "onFalaComecou", "onNivel")

    OnCreate {
      val context = appContext.reactContext ?: return@OnCreate
      textToSpeech = TextToSpeech(context.applicationContext) { status ->
        if (status == TextToSpeech.SUCCESS) {
          val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
          textToSpeech?.setAudioAttributes(attributes)
          textToSpeech?.setOnUtteranceProgressListener(ttsProgressListener)
          isTtsReady = true
          ttsInitPromises.toList().forEach { it.resolve(Unit) }
        } else {
          ttsInitPromises.toList().forEach {
            it.reject("TTS_INIT_FAILED", "O mecanismo de voz do Android não foi inicializado.", null)
          }
        }
        ttsInitPromises.clear()
      }
    }

    OnDestroy {
      encerrarSessaoInterna()
      textToSpeech?.stop()
      textToSpeech?.shutdown()
      textToSpeech = null
      isTtsReady = false
      speechPromises.clear()
      pararPlayerELimparFila()
    }

    AsyncFunction("iniciarSessao") { promise: Promise ->
      if (isCapturing.get()) {
        promise.resolve(buildSessionInfo())
        return@AsyncFunction
      }
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("NO_CONTEXT", "Contexto Android indisponível.", null)
        return@AsyncFunction
      }

      val manager = audioManager ?: run {
        promise.reject("NO_AUDIO_MANAGER", "AudioManager indisponível.", null)
        return@AsyncFunction
      }

      try {
        manager.mode = AudioManager.MODE_IN_COMMUNICATION

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          val devices = manager.availableCommunicationDevices
          val scoDevice = devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
          if (scoDevice != null) {
            manager.setCommunicationDevice(scoDevice)
            communicationDevice = scoDevice
          }
        } else {
          @Suppress("DEPRECATION")
          manager.startBluetoothSco()
          manager.isBluetoothScoOn = true
        }

        val minBufferSize = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)
        val bufferSize = maxOf(minBufferSize, bytesPerFrame * 10)
        val record = AudioRecord(
          MediaRecorder.AudioSource.VOICE_COMMUNICATION,
          sampleRate,
          channelConfig,
          audioFormat,
          bufferSize
        )

        if (record.state != AudioRecord.STATE_INITIALIZED) {
          record.release()
          desfazerPerfilChamada()
          promise.reject("RECORD_INIT_FAILED", "AudioRecord não pôde ser inicializado.", null)
          return@AsyncFunction
        }

        audioRecord = record
        record.startRecording()
        isCapturing.set(true)
        circularWriteIndex = 0
        circularFramesFilled = 0
        speechFrames.clear()
        inSpeech = false
        aboveThresholdMs = 0
        silenceMs = 0
        speechDurationMs = 0
        lastNivelEventTime = 0

        captureThread = Thread({ capturarLoop() }, "escuta-aí-captura")
        captureThread?.start()

        promise.resolve(buildSessionInfo())
      } catch (e: Exception) {
        desfazerPerfilChamada()
        promise.reject("SESSION_START_FAILED", "Falha ao iniciar sessão: ${e.message}", null)
      }
    }

    AsyncFunction("encerrarSessao") { promise: Promise ->
      encerrarSessaoInterna()
      promise.resolve(Unit)
    }

    AsyncFunction("definirSensibilidade") { limiar: Int, promise: Promise ->
      voiceThreshold = limiar.coerceIn(0, 32767)
      promise.resolve(Unit)
    }

    AsyncFunction("silenciarEntrada") { silenciado: Boolean, promise: Promise ->
      isMuted.set(silenciado)
      promise.resolve(Unit)
    }

    AsyncFunction("falar") { texto: String, idioma: String, promise: Promise ->
      if (!isTtsReady || textToSpeech == null) {
        promise.reject("TTS_NOT_READY", "O mecanismo de voz ainda está iniciando.", null)
        return@AsyncFunction
      }
      val utteranceId = UUID.randomUUID().toString()
      textToSpeech?.language = Locale.forLanguageTag(idioma)
      val result = textToSpeech?.speak(texto, TextToSpeech.QUEUE_ADD, null, utteranceId)
      if (result == TextToSpeech.SUCCESS) {
        speechPromises[utteranceId] = promise
      } else {
        promise.reject("TTS_SPEAK_FAILED", "O Android não conseguiu iniciar a reprodução.", null)
      }
    }

    AsyncFunction("pararFala") { promise: Promise ->
      textToSpeech?.stop()
      speechPromises.toMap().forEach { (_, p) ->
        p.reject("TTS_STOPPED", "Reprodução interrompida pelo usuário.", null)
      }
      speechPromises.clear()
      promise.resolve(Unit)
    }

    AsyncFunction("tocarAudio") { base64: String, formato: String, promise: Promise ->
      val context = appContext.reactContext ?: run {
        promise.reject("NO_CONTEXT", "Contexto Android indisponível.", null)
        return@AsyncFunction
      }
      try {
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        val arquivo = File(context.cacheDir, "voz-${System.currentTimeMillis()}.$formato")
        FileOutputStream(arquivo).use { it.write(bytes) }
        val item = AudioQueueItem(base64, formato, promise, arquivo)
        audioQueue.add(item)
        if (!tocandoAudio) {
          tocarProximo()
        }
      } catch (e: Exception) {
        promise.reject("TOCAR_AUDIO_FAILED", "Falha ao preparar áudio: ${e.message}", null)
      }
    }
  }

  private fun buildSessionInfo(): Map<String, Any?> {
    val manager = audioManager
    val modo = modeLabel(manager?.mode ?: AudioManager.MODE_NORMAL)
    val rotaEntrada = try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        audioRecord?.routedDevice?.productName?.toString() ?: "indisponível"
      } else "indisponível"
    } catch (_: Exception) { "indisponível" }
    val rotaSaida = try {
      val outputs = manager?.getDevices(AudioManager.GET_DEVICES_OUTPUTS) ?: emptyArray()
      val commDevice = outputs.firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
      commDevice?.productName?.toString() ?: communicationDevice?.productName?.toString() ?: "indisponível"
    } catch (_: Exception) { "indisponível" }
    return mapOf(
      "taxaAmostragem" to sampleRate,
      "rotaEntrada" to rotaEntrada,
      "rotaSaida" to rotaSaida,
      "modo" to modo
    )
  }

  private fun modeLabel(mode: Int): String = when (mode) {
    AudioManager.MODE_NORMAL -> "MODE_NORMAL"
    AudioManager.MODE_RINGTONE -> "MODE_RINGTONE"
    AudioManager.MODE_IN_CALL -> "MODE_IN_CALL"
    AudioManager.MODE_IN_COMMUNICATION -> "MODE_IN_COMMUNICATION"
    else -> "MODE_$mode"
  }

  private fun capturarLoop() {
    val buffer = ShortArray(samplesPerFrame)
    val byteBuffer = ByteArray(bytesPerFrame)
    while (isCapturing.get()) {
      val read = audioRecord?.read(buffer, 0, samplesPerFrame, AudioRecord.READ_BLOCKING) ?: 0
      if (read <= 0) continue

      for (i in 0 until read) {
        byteBuffer[i * 2] = (buffer[i].toInt() and 0xFF).toByte()
        byteBuffer[i * 2 + 1] = ((buffer[i].toInt() shr 8) and 0xFF).toByte()
      }
      if (read < samplesPerFrame) {
        for (i in read until samplesPerFrame) {
          byteBuffer[i * 2] = 0
          byteBuffer[i * 2 + 1] = 0
        }
      }

      if (!isMuted.get()) {
        val rms = calcularRms(buffer, read)
        val now = System.currentTimeMillis()
        if (now - lastNivelEventTime >= 200) {
          sendEvent("onNivel", mapOf("rms" to rms))
          lastNivelEventTime = now
        }
        processarDeteccaoFala(byteBuffer, rms)
      } else {
        adicionarAoCircular(byteBuffer)
      }
    }
  }

  private fun calcularRms(samples: ShortArray, count: Int): Int {
    if (count == 0) return 0
    var sum = 0L
    for (i in 0 until count) {
      val s = samples[i].toLong()
      sum += s * s
    }
    return Math.sqrt(sum.toDouble() / count.toDouble()).toInt()
  }

  private fun adicionarAoCircular(frame: ByteArray) {
    circularBuffer[circularWriteIndex] = frame.copyOf()
    circularWriteIndex = (circularWriteIndex + 1) % circularBufferFrames
    if (circularFramesFilled < circularBufferFrames) circularFramesFilled++
  }

  private fun processarDeteccaoFala(frame: ByteArray, rms: Int) {
    if (!inSpeech) {
      adicionarAoCircular(frame)
      if (rms >= voiceThreshold) {
        aboveThresholdMs += frameSizeMs
        if (aboveThresholdMs >= msParaComecar) {
          iniciarFala()
        }
      } else {
        aboveThresholdMs = 0
      }
    } else {
      speechFrames.add(frame.copyOf())
      speechDurationMs += frameSizeMs
      if (rms < voiceThreshold) {
        silenceMs += frameSizeMs
        if (silenceMs >= msDeSilencioParaEncerrar || speechDurationMs >= msMaximoDeFala) {
          encerrarFala()
        }
      } else {
        silenceMs = 0
      }
    }
  }

  private fun iniciarFala() {
    inSpeech = true
    speechStartTime = System.currentTimeMillis()
    aboveThresholdMs = 0
    silenceMs = 0
    speechDurationMs = 0

    for (i in 0 until circularFramesFilled) {
      val idx = (circularWriteIndex - circularFramesFilled + i + circularBufferFrames) % circularBufferFrames
      speechFrames.add(circularBuffer[idx].copyOf())
    }
    speechDurationMs = circularFramesFilled * frameSizeMs

    sendEvent("onFalaComecou", mapOf("em" to speechStartTime))
  }

  private fun encerrarFala() {
    if (speechDurationMs < msMinimoDeFala) {
      resetarDeteccao()
      return
    }
    val wavBytes = gerarWav(speechFrames, speechDurationMs)
    val base64 = Base64.encodeToString(wavBytes, Base64.NO_WRAP)
    val rmsMedio = if (speechFrames.isNotEmpty()) {
      var sum = 0L
      for (frame in speechFrames) {
        val shorts = ShortArray(frame.size / 2)
        for (i in 0 until shorts.size) {
          val baixo = frame[i * 2].toInt() and 0xFF
          val alto = frame[i * 2 + 1].toInt() shl 8
          shorts[i] = (baixo or alto).toShort()
        }
        sum += calcularRms(shorts, shorts.size).toLong()
      }
      (sum / speechFrames.size).toInt()
    } else 0

    sendEvent("onFalaPronta", mapOf("base64" to base64, "ms" to speechDurationMs, "rms" to rmsMedio))
    resetarDeteccao()
  }

  private fun resetarDeteccao() {
    inSpeech = false
    speechFrames.clear()
    speechDurationMs = 0
    aboveThresholdMs = 0
    silenceMs = 0
    circularWriteIndex = 0
    circularFramesFilled = 0
  }

  private fun gerarWav(frames: List<ByteArray>, durationMs: Int): ByteArray {
    val dataSize = frames.sumOf { it.size }
    val wav = ByteArray(44 + dataSize)
    val header = wav
    val data = wav

    var pos = 0
    fun writeString(s: String) {
      for (c in s.toByteArray()) header[pos++] = c
    }
    fun writeInt32(v: Int) {
      header[pos++] = (v and 0xFF).toByte()
      header[pos++] = ((v shr 8) and 0xFF).toByte()
      header[pos++] = ((v shr 16) and 0xFF).toByte()
      header[pos++] = ((v shr 24) and 0xFF).toByte()
    }
    fun writeInt16(v: Int) {
      header[pos++] = (v and 0xFF).toByte()
      header[pos++] = ((v shr 8) and 0xFF).toByte()
    }

    writeString("RIFF")
    writeInt32(36 + dataSize)
    writeString("WAVE")
    writeString("fmt ")
    writeInt32(16)
    writeInt16(1)
    writeInt16(1)
    writeInt32(sampleRate)
    writeInt32(sampleRate * 2)
    writeInt16(2)
    writeInt16(16)
    writeString("data")
    writeInt32(dataSize)

    var dataPos = 44
    for (frame in frames) {
      System.arraycopy(frame, 0, data, dataPos, frame.size)
      dataPos += frame.size
    }
    return wav
  }

  private fun encerrarSessaoInterna() {
    isCapturing.set(false)
    captureThread?.interrupt()
    try { captureThread?.join(500) } catch (_: InterruptedException) {}
    captureThread = null

    audioRecord?.stop()
    audioRecord?.release()
    audioRecord = null

    pararPlayerELimparFila()
    desfazerPerfilChamada()
  }

  private fun desfazerPerfilChamada() {
    val manager = audioManager ?: return
    manager.mode = AudioManager.MODE_NORMAL
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      manager.clearCommunicationDevice()
    } else {
      @Suppress("DEPRECATION")
      manager.stopBluetoothSco()
      manager.isBluetoothScoOn = false
    }
    communicationDevice = null
  }

  private fun tocarProximo() {
    val item = audioQueue.poll() ?: return
    tocandoAudio = true
    mediaPlayer = MediaPlayer().apply {
      setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
      )
      setDataSource(appContext.reactContext!!, Uri.fromFile(item.arquivo))
      setOnPreparedListener { it.start() }
      setOnCompletionListener {
        item.arquivo.delete()
        it.release()
        if (mediaPlayer == this) mediaPlayer = null
        item.promise.resolve(null)
        tocandoAudio = false
        tocarProximo()
      }
      setOnErrorListener { _, _, _ ->
        item.arquivo.delete()
        release()
        if (mediaPlayer == this) mediaPlayer = null
        item.promise.reject("MEDIA_PLAYER_ERROR", "Erro ao reproduzir áudio", null)
        tocandoAudio = false
        tocarProximo()
        true
      }
      prepareAsync()
    }
  }

  private fun pararPlayerELimparFila() {
    mediaPlayer?.apply {
      stop()
      release()
    }
    mediaPlayer = null
    tocandoAudio = false
    audioQueue.forEach { it.arquivo.delete(); it.promise.reject("SESSION_ENDED", "Sessão encerrada", null) }
    audioQueue.clear()
  }

  private val ttsProgressListener = object : UtteranceProgressListener() {
    override fun onStart(utteranceId: String) {}

    override fun onDone(utteranceId: String) {
      speechPromises.remove(utteranceId)?.resolve(Unit)
    }

    override fun onStop(utteranceId: String, interrupted: Boolean) {
      speechPromises.remove(utteranceId)?.resolve(Unit)
    }

    override fun onError(utteranceId: String, errorCode: Int) {
      speechPromises.remove(utteranceId)?.reject("TTS_ERROR", "Erro de síntese: código $errorCode", null)
    }

    @Deprecated("Required by Android TextToSpeech")
    override fun onError(utteranceId: String) {
      speechPromises.remove(utteranceId)?.reject("TTS_ERROR", "O Android relatou um erro de síntese.", null)
    }
  }
}