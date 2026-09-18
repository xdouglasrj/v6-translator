# O compilador do Android reprovou o módulo. Corrija exatamente estes 5 pontos.

Arquivo: `frontend/modules/escuta-audio/android/src/main/java/expo/modules/escutaaudio/EscutaAudioModule.kt`.
As mensagens abaixo são do compilador Kotlin de verdade, na montagem do app.

1. Linha 41 — `Unresolved reference 'CHANNEL_IN_MONO'`: essa constante NÃO fica em
   `AudioRecord`, e sim em `AudioFormat`. Troque para `AudioFormat.CHANNEL_IN_MONO`
   e acrescente o import `android.media.AudioFormat` se faltar.

2. Linha 42 — `Unresolved reference 'ENCODING_PCM_16BIT'`: idem, é
   `AudioFormat.ENCODING_PCM_16BIT`.

3. Linha 127 — `Condition type mismatch: inferred type is 'Unit' but 'Boolean' was expected`:
   `manager.startBluetoothSco()` devolve `Unit`, não `Boolean`, então `val scoStarted = ...`
   seguido de `if (scoStarted)` não compila. Chame o método e, na linha seguinte, defina
   `manager.isBluetoothScoOn = true`, sem o `if`.

4. Linha 341 — `Argument type mismatch: actual type is 'Int', but 'Short' was expected` e
   os dois erros de sintaxe na mesma linha: a expressão que monta o `Short` está errada.
   Escreva assim, em duas etapas, sem parênteses aninhados:
```
val baixo = frame[i * 2].toInt() and 0xFF
val alto = frame[i * 2 + 1].toInt() shl 8
shorts[i] = (baixo or alto).toShort()
```
   O `and 0xFF` no byte baixo é obrigatório: sem ele, bytes negativos estragam a amostra.

5. Depois de corrigir, releia o arquivo inteiro procurando o MESMO tipo de erro:
   constante buscada na classe errada, retorno `Unit` usado como valor, e mistura de
   `Byte`, `Short` e `Int` sem conversão explícita. Corrija o que encontrar e liste no
   relatório.

Não reindente, não mude comportamento, não mexa em outro arquivo, não faça commit, não
crie docs, não faça pergunta.
