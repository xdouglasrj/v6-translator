package expo.modules.v6mediatts

import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale
import java.util.UUID

class V6MediaTtsModule : Module() {
  private var textToSpeech: TextToSpeech? = null
  private var isReady = false
  private val preparePromises = mutableListOf<Promise>()
  private val speechPromises = mutableMapOf<String, Promise>()

  private val audioManager: AudioManager?
    get() = appContext.reactContext?.getSystemService(AudioManager::class.java)

  override fun definition() = ModuleDefinition {
    Name("V6MediaTts")
    Events("onSpeechStart", "onSpeechDone", "onSpeechError")

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
    }

    OnDestroy {
      textToSpeech?.stop()
      textToSpeech?.shutdown()
      textToSpeech = null
      isReady = false
      speechPromises.clear()
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
}