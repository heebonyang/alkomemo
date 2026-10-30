# 알코 노트 (ALKO note)

구글 계정으로 로그인해서, 원하는 사람과 공유 노트를 만들어 함께 쓰는 메모장이에요.

## 지금 바로 개발하기 (로그인 설정 없이)

`public/config.js`의 Firebase 설정을 비워 두면(`YOUR_...` 그대로) **로컬 개발 모드**로 실행돼요.

- 데이터는 이 브라우저의 localStorage에 저장돼요.
- 로그인 대신 '사용자 1'과 '사용자 2' 중 하나를 골라 들어가요. 탭마다 다른 사용자로 들어가면 함께 쓰는 상황을 시험할 수 있어요.
- 초대는 `user1@local`, `user2@local` 로 보내면 돼요.
- 화면 위쪽에 `dev` 표시가 붙어요.
- 개인 노트 보호는 Firebase를 연결해야 실제로 적용돼요.

브라우저 보안 정책 때문에 `index.html`을 더블클릭해서는 열 수 없어요. 간단한 로컬 서버로 열어 주세요.

```bash
cd public && python3 -m http.server 8000
```

그다음 브라우저에서 http://localhost:8000 을 열어요.

나중에 Firebase 설정값을 `config.js`에 넣으면 코드 수정 없이 구글 로그인 모드로 바뀌어요.

## 기능

- **노트북**: 맨 윗줄의 탭 하나하나가 노트북이에요. 맨 윗줄 + 로 이름을 정해 새 노트북을 만들어요. 노트북마다 노트와 진행 중인 프로젝트 보드(마감일·D-day)가 따로 있어요.
  - 그냥 만들면 나 혼자 쓰는 노트북(호박색), "다른 사람을 초대해서 공유 노트북으로 만들기"를 체크하면 공유 노트북(파랑)이에요.
  - 끌어서 놓으면 순서를 바꿀 수 있어요(휴대폰은 꾹 누른 뒤 끌기, 키보드는 Alt + ←/→). 순서는 사람마다 따로 저장돼요.
  - 선택한 노트북 오른쪽의 휴지통 아이콘으로 삭제해요(한 번 더 눌러 확인). 공유 노트북을 다른 사람이 만들었다면 같은 자리에서 나가기를 해요.
  - 기본 노트북인 **노트**는 다른 사람에게 보이지 않고, 지울 수 없어요.
- **초대**: 노트북 설정(목록 위 사람 아이콘)에서 함께할 사람의 구글 이메일을 넣어 초대장을 보내요. 그 사람이 알코 노트에 같은 구글 계정으로 로그인하면 화면 위쪽에 초대장이 보이고, 수락하면 멤버가 돼요. 실제 이메일이 발송되지는 않으니 주소(https://alkonote.web.app)는 따로 알려 주세요.
- 공유 노트북의 내용은 그 멤버만 읽고 쓸 수 있어요. 서버 보안 규칙(`firestore.rules`)이 막아요. 삭제는 만든 사람만 할 수 있어요.

## 파일 구성

| 파일 | 역할 |
| --- | --- |
| `public/index.html`, `public/app.js` | 웹페이지 |
| `public/store.js` | 저장소와 로그인 연결 (Firebase 모드 / 로컬 개발 모드 자동 선택) |
| `public/config.js` | Firebase 설정값 (**직접 채워야 해요**) |
| `firestore.rules` | 데이터베이스 보안 규칙: 공유 노트 멤버만 내용을 읽고 쓸 수 있게 해요 |
| `firebase.json`, `.firebaserc` | 배포 설정 |
| `.github/workflows/deploy.yml` | main 에 푸시하면 Firebase 에 자동 배포 (6단계 설정 후) |

## 구글 로그인 설정 순서 (나중에 한 번, 15분쯤 걸려요)

### 1. Firebase 프로젝트 만들기
1. https://console.firebase.google.com 에 접속해서 **프로젝트 추가**를 눌러요. Google Analytics는 꺼도 돼요.
2. 무료 요금제(Spark)로도 충분해요.

### 2. 구글 로그인 켜기
1. 왼쪽 메뉴에서 **빌드 > Authentication > 시작하기**를 눌러요.
2. **로그인 방법** 탭에서 **Google**을 선택하고, 사용 설정을 켠 뒤 저장해요.

### 3. 데이터베이스 만들기
1. **빌드 > Firestore Database > 데이터베이스 만들기**를 눌러요.
2. 위치는 `asia-northeast3 (서울)`을 고르면 빨라요.
3. **프로덕션 모드**로 시작해요. 보안 규칙은 4단계에서 이 프로젝트의 규칙 파일로 덮어써요.

### 4. 웹 앱 등록하고 설정값 넣기
1. **프로젝트 설정(톱니바퀴) > 일반 > 내 앱**에서 웹 아이콘 `</>`을 눌러 앱을 등록해요. Hosting 체크는 안 해도 돼요.
2. 화면에 나오는 `firebaseConfig` 값을 `public/config.js`에 붙여 넣어요.
3. `.firebaserc`의 `YOUR_PROJECT_ID`를 프로젝트 ID로 바꿔요.

> `firebaseConfig`의 apiKey는 비밀번호가 아니라서 공개돼도 괜찮아요. 실제로 데이터를 지키는 건 `firestore.rules`예요.

### 5. 배포하기
Node.js가 설치된 컴퓨터에서 이 폴더로 이동한 뒤 실행해요.

```bash
npm install -g firebase-tools
```

```bash
firebase login
```

```bash
firebase deploy
```

끝나면 `https://alkonote.web.app` 주소가 나와요. 이 주소로 들어가서 구글 계정으로 로그인하면 돼요. 함께 쓸 사람에게도 이 주소를 알려 주세요.

### 6. (선택) 푸시하면 자동 배포
GitHub 저장소의 main 브랜치에 푸시할 때마다 `.github/workflows/deploy.yml` 이 웹페이지와 보안 규칙을 배포해요. 설정 전에는 배포를 건너뛰고 실패하지 않아요.

1. Google Cloud 콘솔(https://console.cloud.google.com) 에서 이 Firebase 프로젝트를 고른 뒤 **IAM 및 관리자 > 서비스 계정 > 서비스 계정 만들기**를 눌러요.
2. 역할에 **Firebase 관리자**와 **서비스 사용량 소비자**를 넣어요.
3. 만든 서비스 계정에서 **키 > 키 추가 > JSON** 을 눌러 키 파일을 받아요. 이 파일은 비밀번호와 같으니 저장소에 올리면 안 돼요.
4. GitHub 저장소의 **Settings > Secrets and variables > Actions > New repository secret** 에서 이름은 `FIREBASE_SERVICE_ACCOUNT`, 값은 키 파일 내용 전체를 붙여 넣어요.
5. 이제 main 에 푸시하면 **Actions** 탭에서 배포가 진행되는 걸 볼 수 있어요.

## 고치고 올리는 흐름

```bash
git add .
```

```bash
git commit -m "무엇을 바꿨는지 짧게"
```

```bash
git push
```

6단계를 마쳤다면 푸시만으로 1~2분 뒤 사이트에 반영돼요. 아니라면 푸시한 뒤 `firebase deploy` 를 실행해요.

## 나중에 바꾸고 싶을 때

- **Firebase Hosting 말고 다른 곳(예: GitHub Pages)에 올릴 때**: 그 주소를 **Authentication > 설정 > 승인된 도메인**에 추가해야 로그인이 돼요. 규칙만 다시 올리려면 `firebase deploy --only firestore:rules`를 실행해요.

## 알아 두면 좋은 점

- 같은 노트를 여러 사람이 동시에 고치면, 나중에 저장된 내용이 남아요.
- 글은 입력을 멈추고 0.8초 뒤에 자동으로 저장돼요. `Ctrl/⌘ + S`를 누르면 바로 저장돼요.
- 개인 노트는 Firebase 콘솔에 들어갈 수 있는 프로젝트 관리자라면 볼 수 있어요. 앱 화면에서만 숨겨지는 거예요.
