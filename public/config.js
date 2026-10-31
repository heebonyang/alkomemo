// Firebase 웹 앱 설정 (Firebase 콘솔 > 프로젝트 설정 > 내 앱). 웹사이트에 공개되는 값이라 저장소에 있어도 괜찮아요.
// 데이터는 firestore.rules 가 지켜요. 값을 YOUR_... 로 되돌리면 로컬 개발 모드(로그인 없이 사용자 1/2)로 실행돼요.
export const firebaseConfig = {
  apiKey: "AIzaSyDJXsS6AJ7baux8zPl4Z3GQ-7agmKKtuQ4",
  authDomain: "alkonote.web.app", // 사이트와 같은 주소여야 크롬(제3자 저장소 차단)에서도 로그인이 유지됨
  projectId: "alkomemo",
  storageBucket: "alkomemo.firebasestorage.app",
  messagingSenderId: "947789314675",
  appId: "1:947789314675:web:2cf3a7fa47772d65058806",
  measurementId: "G-5MSKWDBJVS",
};
