// Creates the Phase 1 voice agent via Bolna's real POST /agent endpoint.
// Just the "conversation" task for now - extraction/webhook tasks deferred
// until the real quickstart_server.py bug (line 69, wrong dict nesting for
// extraction_details) is patched. EXTRACTION_DETAILS below is kept ready for
// when that's wired back in.

// Rebuilt into Tenglish (Telugu with natural English code-switching) 2026-09-02:
// most real clients are Telugu speakers, English is only for international
// clients. Verified before writing this: (1) Groq openai/gpt-oss-20b produces
// genuinely fluent, natural Tenglish (real test call, correct grammar, business
// terms like "website"/"CMS"/"SEO" kept in English as a real speaker would),
// (2) the OmniVoice reference clip is already Telugu (never changed to English),
// so this is back to within-language synthesis, not cross-lingual - resolves the
// earlier Telugu-leakage problem entirely rather than working around it.
const SYSTEM_PROMPT = `మీరు సిద్ధు యొక్క AI అసిస్టెంట్ - సిద్ధు వ్యాపారం తరపున కాల్స్ answer చేస్తున్నారు, ఇది Indian small businesses కి WhatsApp bots, websites, n8n automation, మరియు voice agents అమ్ముతుంది.

IDENTITY: మీరు సిద్ధు కాదు అని ఎప్పుడూ చెప్పకండి. "మీరు bot నా?" అని అడిగితే, cheerfully ఒప్పుకోండి - అది product యొక్క live demo.

NO REPEATS (ఏ topic అయినా - identity, purpose, price, ఏదైనా): మీరు ఇంతకుముందు cover చేసిన విషయం మళ్ళీ explain చేయకండి, caller వేరే విధంగా అడిగినా సరే. ఒకసారి repeat అయితే, ఒక్క short line చెప్పి ("నేను ఇందాకే చెప్పానుగా...") conversation ని ముందుకు తీసుకెళ్ళండి - కొత్త question లేదా సిద్ధు తో call కి pivot చేయండి. మూడోసారి అదే topic వస్తే, explain చేయడం ఆపి సిద్ధు తో call ఆఫర్ చేయండి.

OBJECTIONS: Caller మాటల్లోనే acknowledge చేయండి, real blocker ఏంటో తెలుసుకోవడానికి ఒక్క question అడగండి (price, timing, trust, లేదా decision maker కాదు), తర్వాత next step కి pivot చేయండి. ఎప్పుడూ argue చేయకండి లేదా harder గా re-pitch చేయకండి.

TONE: Caller rushed గా, annoyed గా ఉంటే లేదా మీ మీద మాట్లాడుతూ ఉంటే, discovery skip చేసి direct గా సిద్ధు తో call ఆఫర్ చేయండి లేదా politely close చేయండి. Caller English లో మాట్లాడితే, English కి switch అవ్వండి - వాళ్ళ language లోనే మాట్లాడండి.

OPENING (call లో మీ మొదటి reply, దేనికన్నా ముందు): మీ పేరు మరియు purpose గురించి briefly introduce అవ్వండి - మీరు ఎవరో మరియు సిద్ధు వ్యాపారం ఏం చేస్తుందో (WhatsApp bots, websites, n8n automation, voice agents Indian small businesses కోసం) - తర్వాత ఇప్పుడు మాట్లాడటానికి మంచి time నా అని అడగండి. వాళ్ళ పేరు లేదా అవసరం ఇంకా అడగకండి. "వద్దు ఇప్పుడు కుదరదు" అంటే, ఇంకెప్పుడు మంచిదో అడగండి లేదా callback ఆఫర్ చేసి, politely call ముగించండి - pitch లోకి వెళ్లకండి. వాళ్ళు agree అయితేనే (లేదా వాళ్ళే directly తమ అవసరం చెప్పడం మొదలుపెడితే) కింద flow కి వెళ్ళండి.

FLOW (opening తర్వాత): పేరు మరియు అవసరం అడగండి -> pitch చేయకముందే వాళ్ళ నిజమైన pain తెలుసుకోండి -> సరిపోయే exactly ఒక్క service కి map చేయండి -> budget, timeline, decision-maker qualify చేయండి -> sale కాదు, సిద్ధు తో call కి close చేయండి.

GUARDRAILS:
- Final price చెప్పకండి - మొదటిసారి మాత్రమే, ఇలా చెప్పండి: "సాధారణంగా setup కి పది నుండి ఇరవై ఐదు వేల రూపాయలు plus monthly retainer అవుతుంది, మీ scope అర్థం చేసుకున్న తర్వాత సిద్ధు exact number confirm చేస్తారు." మళ్ళీ చెప్పకండి - NO REPEATS వాడండి.
- Delivery dates చెప్పకండి. Work already done అని ఎప్పుడూ చెప్పకండి, నిజంగా అయితేనే తప్ప.
- ఏదైనా తెలియకపోతే, అలాగే చెప్పండి, సిద్ధు తో callback ఆఫర్ చేయండి.
- Caller angry గా, confused గా ఉంటే లేదా human కావాలంటే: selling ఆపి, వాళ్ళ number తీసుకుని, politely ముగించండి.

STYLE: ప్రతి reply 3 sentences లోపు ఉండాలి. Plain spoken sentences మాత్రమే - lists వద్దు, markdown వద్దు, written-register భాష వద్దు. Numbers ఎలా మనం మామూలుగా మాట్లాడేటప్పుడు చెప్తామో అలా చెప్పండి.`;

// Server-side (local_setup/quickstart_server.py's create_agent) feeds this
// verbatim to an LLM (EXTRACTION_PROMPT_GENERATION_MODEL) which converts it
// into the structured extraction_json schema used at call time - it must be
// a numbered plain-language description, not pre-built JSON (confirmed by
// reading the actual server code after a real KeyError on "extraction_json").
const EXTRACTION_DETAILS = `1. Caller Name
The caller's name, if they gave it during the call. Use an empty string if not mentioned.

2. Business Type
What kind of business the caller runs, based on what they described.

3. Pain Point
The specific manual or painful process the caller described having today.

4. Service Matched
Which one of these the conversation identified as the fit: WhatsApp bots, websites, n8n automation, voice agents. Empty string if none was reached.

5. Budget Range
Any budget information the caller gave, as close to verbatim as possible. Empty string if not discussed.

6. Is Decision Maker
true, false, or "unknown" based on whether the caller indicated they are the actual decision maker for their business.

7. Next Step
What was agreed as the next step - for example "callback scheduled", "caller declined", "call ended - angry or confused", or "no clear outcome".

8. Timeline
Any timeline or urgency the caller mentioned. Empty string if not discussed.`;

const agentConfig = {
  agent_config: {
    agent_name: "Siddu Assistant",
    agent_type: "other",
    agent_welcome_message: "హాయ్, నేను సిద్ధు యొక్క AI assistant. WhatsApp bots, websites, automation లాంటి వాటితో India లో small businesses కి సహాయం చేస్తాను. ఇప్పుడు కొన్ని నిమిషాలు మాట్లాడటానికి మంచి time నా?",
    tasks: [
      {
        task_type: "conversation",
        toolchain: { execution: "parallel", pipelines: [["transcriber", "llm", "synthesizer"]] },
        tools_config: {
          input: { format: "wav", provider: "plivo" },
          output: { format: "wav", provider: "plivo" },
          transcriber: {
            provider: "deepgram",
            language: "te",
            // nova-2 (the framework default) does not support Telugu at all - real
            // confirmed 400 error (2026-09-02): "No such model/language/tier
            // combination found. You could try the general model (language: te,
            // Nova-3 tier)." nova-3 works, verified on a real Telugu sample - broadly
            // accurate, though confidence dips on English-origin code-switched words
            // (transliterated phonetically into Telugu script, e.g. "Honey" -> "హనీ").
            // Worth revisiting if that turns out to cause real misunderstandings on
            // business terms like "website"/"WhatsApp" once tested on real calls.
            model: "nova-3",
            stream: true,
          },
          llm_agent: {
            agent_type: "simple_llm_agent",
            agent_flow_type: "streaming",
            llm_config: {
              provider: "groq",
              model: "groq/openai/gpt-oss-20b",
              temperature: 0.3,
              request_json: false,
              // Tried compound-mini (70000 TPM outer limit) after gpt-oss-20b
              // died mid-call on a Groq 429. It still died - because it
              // internally routes every turn through gpt-oss-120b, which has
              // its OWN separate 8000 TPM budget (confirmed via a second
              // real call's logs: same "Limit 8000" error, just for
              // gpt-oss-120b this time, at conversation_time ~240s instead
              // of ~140s). Compound-mini spends MORE tokens per turn
              // (2-hop routing) to reach the same 8000 ceiling, so it's
              // strictly worse than calling gpt-oss-20b directly once the
              // real fix (shorter prompt, higher interruption threshold ->
              // fewer regenerations) is in place. Reverted to direct 20b.
              max_tokens: 400,
            },
          },
          synthesizer: {
            provider: "omnivoice",
            // MUST be true, even though OmniVoice's own transport is plain HTTP (not a
            // websocket) - task_manager.py reads THIS top-level flag (not the synthesizer
            // instance) to decide its whole transcriber turn-handling mode (interim vs
            // final distinction, interruption/barge-in, eager LLM). false silently drops
            // the call into a much dumber path that fires a fresh LLM call on every
            // interim word - real, reproduced bug: burned through the whole Groq TPM
            // budget in ~14s and never played a single reply. OmniVoiceSynthesizer's own
            // __init__ hardcodes self.stream = False internally regardless of this value
            // (same pattern as the built-in OpenAI synthesizer), so this is safe - it
            // only unlocks task_manager's real-time engine, it does not make OmniVoice
            // itself try to stream over a websocket it doesn't have.
            stream: true,
            audio_format: "wav",
            provider_config: { voice_id: "siddu", voice: "siddu", language: "te", speed: 1.08 },
            // Reverted 2026-09-02: lowering this to 120 to start audio sooner backfired -
            // omnivoice_server.py serializes ALL synthesis through one GPU lock, so a
            // 2nd chunk can't even start generating until the 1st finishes (~2-5s each).
            // Splitting a reply produced an audible gap mid-reply (play chunk 1, silence,
            // generate chunk 2) instead of one clean upfront wait - worse than the
            // original single-block behavior. Real fix for lag needs either true
            // GPU/generation parallelism or a lower per-call latency floor, neither of
            // which buffer_size alone can provide - back to whole-reply synthesis for now.
            buffer_size: 400.0,
          },
        },
        task_config: {
          hangup_after_silence: 30,
          // Default is 1 word - real first call showed the agent cutting
          // itself off mid-sentence on very light caller sounds/interim
          // transcripts. Raised 3 -> 5 after a real call (9 interruptions in
          // 240s) burned through Groq's free-tier TPM budget: every
          // interruption cancels + regenerates a full LLM completion, so
          // fewer false-positive interruptions directly means fewer wasted
          // completions and less token burn per minute, not just a UX tweak.
          number_of_words_for_interruption: 5,
        },
      },
      // extraction + webhook tasks deliberately deferred - see chat: real bug
      // in local_setup/quickstart_server.py's create_agent (line 69 looks for
      // extraction_details in the wrong dict level). Will patch once the core
      // conversation flow itself is validated over a few real calls.
    ],
  },
  agent_prompts: {
    task_1: { system_prompt: SYSTEM_PROMPT },
  },
};

const EXISTING_AGENT_ID = process.env.UPDATE_AGENT_ID;

(async () => {
  const url = EXISTING_AGENT_ID ? `http://localhost:5001/agent/${EXISTING_AGENT_ID}` : "http://localhost:5001/agent";
  const method = EXISTING_AGENT_ID ? "PUT" : "POST";
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(agentConfig),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error((EXISTING_AGENT_ID ? "UPDATE" : "CREATE") + " FAILED", res.status, JSON.stringify(body, null, 2));
    process.exit(1);
  }
  console.log("Created agent:", JSON.stringify(body, null, 2));
})();
