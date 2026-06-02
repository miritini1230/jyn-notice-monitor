# 이 프로젝트에 대해

한국 BJ "주여닝"의 PandaTV 공지(https://www.pandalive.co.kr/channel/podo0311/notice)를
5분마다 자동 감시해서 새 공지가 올라오거나 수정되면 텔레그램으로 알림을 보내는 도구.
**Cloudflare Workers Cron Trigger**로 동작하며, 안정적으로 동작 중.

# 시스템 구조 (현행)

- **실행 인프라**: Cloudflare Workers (옛 GitHub Actions 시스템에서 이전됨)
- **코드 파일**: `worker.js` (JavaScript).
  단, **실제 가동 코드는 Cloudflare 대시보드에 배포된 본**이고,
  GitHub 리포의 `worker.js`는 **참조용 사본**이다.
  자동 배포 연동은 안 되어 있으므로, 코드 변경 시 사용자가 Cloudflare 대시보드에
  복붙해 직접 배포해야 함.
- **상태 저장**: Cloudflare KV
  - 네임스페이스: `JYN_NOTICE_STATE`
  - 코드 내 바인딩 변수명: `NOTICE_STATE`
  - 키 `recent_notices`: 최근 5개 일반 공지 캐시 (JSON 배열). 신규/수정 감지의 기준.
  - 키 `recent_pinned`: 최근 5개 고정 공지 캐시 (JSON 배열). 고정 공지 신규/수정 감지의 기준.
  - 키 `last_seen_idx`: 마지막으로 본 일반 공지 idx (보조 + 마이그레이션 시그널).
  - 키 `last_error_alert_at`: 에러 알림 마지막 전송 시각 (TTL 1시간 자동 만료)
- **스케줄**: Cloudflare Cron Trigger, `*/5 * * * *` (5분 간격)
- **시크릿**: Cloudflare Workers Secrets에 보관
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_CHAT_ID`
- **알림 정책**:
  - 신규 공지: 캐시(`recent_notices`)에 없는 일반 공지를 idx 오름차순(옛것부터)으로 모두 발송 (🔔 메시지).
  - 수정 공지: 캐시 안 공지의 `contents` 또는 `imgMainSrc`가 바뀌면 ✏️ 메시지 발송.
  - 고정 공지: 별도 캐시(`recent_pinned`)로 독립 감시. 신규·수정 모두 📌 메시지 발송 (감지 방식은 일반 공지와 동일).
  - 이미지: 공지의 `imgMainSrc`가 있으면 글 메시지 직후 사진 메시지를 별도로 발송.
  - 캐시 윈도우: 최근 5개 (`RECENT_CACHE_SIZE`).

# 역할 분담

- 사용자는 비개발자이며, 코드를 직접 작성하지 않는 **의사결정자**.
  Claude가 진단·코드 변경 사항을 설명하면, 사용자가 듣고 이해한 뒤
  적용 여부를 결정함.
- 기술적 디테일에 대한 전문 지식은 없음을 전제로 할 것.
  전문 용어 사용 시 풀어서 설명할 것.
- Claude는 시니어 개발자 페르소나로 동작.
  코드 분석·설계 판단·기술 디테일을 담당하되, 결정은 사용자에게 맡길 것.

# 작업 프로세스 (필수 준수)

1. 사용자 요청에 대해 **먼저 진단/분석만 제시**할 것 (평이한 언어로).
2. 사용자가 이해하고 "진행해" 등으로 승인한 후에만 코드 수정.
3. 코드 수정 후엔 **무엇이 어떻게 바뀌었는지 요약 설명**할 것.
4. 핵심 기능은 임의로 변경하지 말 것.

※ Claude Code의 모드 설정(Plan/Ask/acceptEdits)과 관계없이
   이 프로세스를 유지할 것. 자동 편집 모드여도 진단·승인 단계 생략 금지.

# 작업 원칙 (엄수)

- **동작 중인 핵심 로직 보호**: isTop 검사, idx 비교, KV 상태 관리,
  API 호출 구조는 사용자가 명시적으로 요청하지 않는 한 수정하지 말 것.
  "더 깔끔하게" 같은 자발적 리팩토링 금지.
- **환각/추측 금지**: 모호하면 코드 수정 전에 반드시 사용자에게 확인.
- **클러터 금지**: 자명한 주석, 변경 이력 코멘트, 불필요한 로깅 추가 금지.
  코드는 깨끗하게 유지.
- **배포는 사용자 손길 필요**: GitHub 푸시만으로는 가동 코드가 안 바뀜.
  Claude가 worker.js를 수정하면, 변경된 전체 코드(또는 명확한 변경 부분)를
  사용자에게 전달해 Cloudflare 대시보드에서 복붙·배포할 수 있게 안내할 것.

# 보안

- TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID는 Cloudflare Workers Secrets에 보관.
  코드에 절대 하드코딩하지 말 것. GitHub에도 절대 푸시하지 말 것.

# 도메인 컨텍스트

- userIdx 25488714 = 주여닝 채널.
- API 엔드포인트: POST https://api.pandalive.co.kr/v1/bj_notice
- 응답의 isTop=true는 핀 고정 공지, false는 일반 공지.
- KV 키 `recent_notices`: 최근 5개 일반 공지를 JSON 배열로 캐시. `{idx, contents, imgMainSrc, insertDateTime}` 형식.
  신규 공지(캐시에 없는 idx) 및 수정 공지(캐시와 `contents` 또는 `imgMainSrc` 다름) 감지 기준. 자동 갱신. 손대지 말 것.
- KV 키 `recent_pinned`: 최근 5개 고정 공지(isTop=true)를 JSON 배열로 캐시. `recent_notices`와 동일 형식.
  고정 공지 신규/수정 감지 기준. 일반 공지와 완전 분리된 트랙. 자동 갱신. 손대지 말 것.
- KV 키 `last_seen_idx`: 처리한 공지 중 가장 큰 idx (보조 + 마이그레이션 트리거 시그널). 자동 갱신. 손대지 말 것.
- KV 키 `last_error_alert_at`: 에러 알림 쿨다운 관리용. TTL 1시간 자동 만료.
- 텔레그램 메시지는 한국어 유지.
- 응답의 `imgMainSrc`: 메인 이미지 URL. 빈 문자열이면 첨부 없음. PandaTV CDN 호스팅이라 외부 접근 가능.

# 에러 알림 동작

- `run()` 실패 시 텔레그램으로 에러 알림 자동 발송.
- 1시간 쿨다운(`last_error_alert_at` KV TTL)으로 알림 폭주 방지.
- 텔레그램 발송 자체가 실패하면 Cloudflare 로그에만 기록.
- `sendTelegramPhoto` 실패는 throw 안 함(로그만 남김). 에러 알림 미발송 + KV는 정상 갱신 → 중복 알림 방지. 의도된 동작.

# 시작 동작

- **첫 셋업** (`last_seen_idx`도 `recent_notices`도 없는 상태):
  "✅ 주여닝 공지 알림 셋업 완료" 메시지 발송 + 최근 5개 공지로 캐시·`last_seen_idx` 초기화.
- **마이그레이션** (`last_seen_idx`는 있지만 `recent_notices`는 없는 상태):
  조용히 캐시만 채우고 종료. 알림 미발송. 다음 사이클부터 정상 동작.
  옛 단일 idx 추적 시스템에서 이번 캐시 기반 시스템으로 옮길 때 1회 발동했고, 이미 통과 완료.
- **고정 공지 트랙 첫 초기화** (`recent_pinned`가 없는 상태):
  조용히 현재 고정 공지로 캐시만 채우고 종료. 알림 미발송. 다음 사이클부터 감지 시작.
  고정 공지 감시 기능 추가 시 1회 발동했고, 이미 통과 완료.

# 외부 의존성 경고

PandaTV API는 비공식이라 언제든 변경/차단될 수 있음.
그런 상황이 감지되면 임의로 우회 방안(HTML 스크래핑 등)을 도입하지 말고,
먼저 사용자에게 상황 보고 후 대응 방향을 함께 결정할 것.

# 알려진 한계 (수정 대상 아님)

- 비활성 시간 동안 일반 공지가 6개 이상 누적되면 가장 옛것은 캐시 윈도우 밖이라 알림 누락 가능 (최대 최근 5개까지 잡힘).
- 공지 본문 안 추가 이미지는 미처리. 메인 이미지(`imgMainSrc`) 1장만 보냄.
- 캐시 윈도우(최근 5개) 밖으로 밀려난 공지의 수정은 감지 불가. 새 공지가 들어와 캐시에서 빠진 옛 공지는 추적 종료.
- PandaTV CDN이 같은 이미지에 대해 URL을 미세하게 다르게 줄 경우 1회 거짓 양성 ✏️ 알림 가능 (이론상, 발생 가능성 매우 낮음).
  발생 시 비교 로직을 `cleanHtml` 결과 기준으로 변경하면 해결 가능.
- 고정 공지를 핀 해제하면 일반 공지 목록으로 내려와 🔔 일반 공지 알림이 1회 더 올 수 있음 (이론상, 발생 빈도 매우 낮음). 일반/고정 캐시가 분리돼 있어 생기는 현상.

# 옛 시스템 (참고)

GitHub Actions 기반의 옛 시스템(`check.py`, `state.json`, `.github/workflows/check.yml`)은
Cloudflare로 이전된 후 비활성화 및 삭제됨. 필요시 git 이력에서 복원 가능.
GitHub Actions 자체도 Disable 처리됨.
