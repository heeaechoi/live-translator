# 🎧 Live Translator: 아이패드 음성 실시간 영→한 번역

아이패드에서 나오는 **영어 음성**(강의, 유튜브, 회의, 팟캐스트)을 듣고 **한국어 자막**을 실시간으로 보여주는 웹앱입니다.

```
[아이패드 Safari]                       [내 PC / 서버]                 [Claude API]
 영어 음성 → 음성인식(Apple, 기기 내)  →  문장 단위로 전송  ─────→   영→한 번역
 한국어 자막 표시  ←─── 글자 단위 스트리밍 ←──────────────────────  (스트리밍)
```

## 빠르고 정확하게 만든 방법

| 항목 | 설명 |
|---|---|
| **빠른 반응** | 음성인식 결과가 확정될 때까지 기다리지 않습니다. 문장이 끝나는 순간(마침표·물음표) 바로 번역을 보내고, 말이 멈추면(기본 0.9초) 남은 부분도 보냅니다. 번역은 글자 단위로 스트리밍되어 첫 글자가 곧바로 나타납니다. 여러 문장을 동시에 번역합니다(최대 3개). |
| **정확한 번역** | 직전 문장 6개(영어+한국어)를 함께 보내서 용어, 말투, 대명사가 앞뒤 문맥과 맞게 번역됩니다. 음성인식 오류(잘못 들은 단어)는 문맥으로 보정하고, "um, uh" 같은 군더더기는 뺍니다. |
| **용어집** | 설정에서 주제와 용어를 적어두면(예: `loss=손실, Andrew Ng=앤드루 응`) 그대로 따릅니다. |
| **자연스러운 자막체** | 직역이 아니라 의미 중심의 자연스러운 한국어로, 기본은 존댓말이고 상황에 따라 반말로 바뀝니다. |
| **편의 기능** | 글자 크기 조절, 영어 원문 표시/숨기기, 화면 꺼짐 방지, 기록 저장(.txt), 홈 화면에 추가(앱처럼 실행). |

번역 엔진은 기본적으로 `claude-opus-5-5`을 가장 빠른 추론 설정(`effort=low`)으로 사용합니다.

---

## 1. 설치 (PC 또는 Mac에서, 한 번만)

[Node.js](https://nodejs.org) 18 이상이 필요합니다.

```bash
git clone https://github.com/heeaechoi/live-translator.git
cd live-translator
npm install
cp .env.example .env      # .env 파일을 열어 ANTHROPIC_API_KEY 입력
```

API 키는 https://console.anthropic.com 에서 발급받습니다.

## 2. 아이패드용 HTTPS 준비

아이패드 Safari는 **https 주소에서만** 마이크와 음성인식을 허용합니다. 아래 두 방법 중 하나를 쓰세요.

**방법 A: 같은 와이파이에서 쓰기 (간단)**

```bash
npm run cert     # 자체 서명 인증서 생성 (macOS/Linux, Windows는 Git Bash)
npm start
```

터미널에 표시되는 `https://192.168.x.x:3443` 주소를 아이패드 Safari에서 엽니다. "연결이 비공개가 아님" 경고가 나오면 **보기 → 이 웹 사이트 방문**을 누르세요.

**방법 B: 어디서든 쓰기 (터널/배포)**

`npm start` 후 [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)로 `cloudflared tunnel --url http://localhost:3000`를 실행하면 https 주소가 생깁니다. Render, Railway, Fly.io 같은 곳에 배포해도 됩니다.
인터넷에 공개할 때는 다른 사람이 내 API 키로 번역하지 못하도록 `.env`에 **`APP_PASSWORD`를 꼭 설정**하세요.

## 3. 아이패드에서 사용하기

1. 아이패드 **설정 → 일반 → 키보드 → 받아쓰기 활성화**를 켭니다 (음성인식에 필요해요).
2. Safari에서 주소를 열고 **▶︎ 시작**을 누른 다음 마이크를 허용합니다.
3. **Split View**로 왼쪽에는 유튜브나 강의 앱, 오른쪽에는 번역 화면을 띄우고 영상을 소리 내어 재생합니다.
   - 번역 화면이 완전히 가려지거나 백그라운드로 가면 iOS가 음성인식을 멈춥니다. 꼭 화면에 함께 띄워두세요.
   - 같은 Safari 안의 다른 탭에서 재생하면 인식이 멈출 수 있으니 **다른 앱이나 Split View의 다른 Safari 창**을 쓰세요.
4. 공유 버튼 → **홈 화면에 추가**를 누르면 앱처럼 전체 화면으로 쓸 수 있습니다.

### 인식이 잘 안 될 때
- 아이패드 볼륨을 충분히 올리세요 (아이패드 마이크로 아이패드 스피커 소리를 듣는 방식입니다).
- 그래도 약하면 **다른 기기**(PC 브라우저, 다른 태블릿이나 폰)에서 이 페이지를 열어 아이패드 옆에 두세요. PC Chrome에서도 똑같이 동작합니다.
- 설정의 "문장 끊는 침묵 시간"을 줄이면 반응이 빨라지고, 늘리면 문장이 덜 끊겨 번역이 더 매끄러워집니다.

## 설정 (.env)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `ANTHROPIC_API_KEY` | (필수) | Claude API 키 |
| `TRANSLATOR_MODEL` | `claude-opus-5-5` | 번역 모델. 지연시간과 비용을 더 줄이려면 `claude-sonnet-5-5` 또는 `claude-haiku-5-5` |
| `TRANSLATOR_EFFORT` | `low` | `low`(가장 빠름, 실시간용 권장) / `medium` / `high` |
| `PORT` / `HTTPS_PORT` | `3000` / `3443` | 서버 포트 |
| `APP_PASSWORD` | (없음) | 접속 비밀번호 (외부 공개 시 권장) |

Opus, Sonnet 모델에서는 드물게 번역이 거절되면 서버가 다른 모델로 자동 재시도합니다(`fallbacks: "default"`).

## 번역 품질 테스트 (아이패드 없이)

```bash
npm run quality                 # 강의·대화·음성인식 오류·관용구·숫자 예시를 실제로 번역
npm run quality -- 내문장.txt    # 내 영어 문장 파일로 테스트 (한 줄에 한 문장)
```

각 문장의 영어 원문과 한국어 번역, 첫 글자가 나오기까지 걸린 시간과 번역이 끝나기까지 걸린 시간을 보여줍니다.
`.env`의 `TRANSLATOR_MODEL`을 바꿔가며 돌려보면 모델별 품질과 속도를 비교할 수 있어요.

## 개발

```bash
npm test     # 문장 분할기 + 번역 요청 단위 테스트
```

- `server.js`: 정적 파일 서빙, `/api/translate` (SSE 스트리밍), HTTPS
- `translator.js`: 번역 프롬프트와 Claude 스트리밍 호출
- `public/segmenter.js`: 실시간 음성인식 결과를 번역 단위로 자르는 로직
- `public/app.js`: 음성인식, 번역 큐, 자막 UI
