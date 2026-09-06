# Configurar Reglas de Golf con IA

El buscador curado funciona siempre. `/api/rules/ask` recupera evidencia del índice local versionado y entrega únicamente esos fragmentos al proveedor seleccionado. La generación no puede responder de memoria cuando la recuperación no encuentra fundamento suficiente.

## Gemini (proveedor predeterminado)

Crea una clave en Google AI Studio y configura estas variables server-side:

```dotenv
RULES_AI_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_RULES_MODEL=gemini-3.5-flash-lite
RULES_AI_ENABLED=true
```

No uses el prefijo `NEXT_PUBLIC_` para la clave. En Vercel agrega las cuatro variables primero al entorno **Preview** y vuelve a desplegar `codex-dev`; después de validar respuestas, fuentes, cuota y reglas locales, agrégalas a **Production** y genera un nuevo deployment de producción cuando ese despliegue esté autorizado.

## OpenAI (alternativa opcional)

La misma recuperación local puede usar OpenAI sin depender de `file_search`:

```dotenv
RULES_AI_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_RULES_MODEL=gpt-5.4-mini
RULES_AI_ENABLED=true
```

`OPENAI_RULES_VECTOR_STORE_ID` ya no es requisito del endpoint. Se conserva únicamente para el script heredado `pnpm rules:index`; los PDFs privados permanecen fuera del repositorio en `rules-source/` o `rules-sources/`.

La API key activa jamás se entrega al cliente ni se registra. Si falta configuración, el endpoint devuelve un estado controlado y el buscador manual sigue disponible. Cambiar variables de Vercel requiere un deployment nuevo para que surtan efecto.

Antes de activar el endpoint, aplica también `20260904104145_rules_ai_rate_limit.sql`. El límite de costo es persistente y atómico en Supabase; solo `service_role` puede usar su RPC. La tabla guarda un HMAC del origen y contadores por ventana, nunca el texto de las consultas, scores, apuestas, históricos ni datos personales.

Las respuestas son informativas: en competencia, el Comité o árbitro tiene la decisión final.
