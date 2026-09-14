// Firebaseコンソール > プロジェクトの設定 > 全般 > マイアプリ から
// ウェブアプリの設定値をコピーしたもの。このファイルはリポジトリに
// コミットしている（.gitignore対象ではない）。apiKeyはFirebaseの設計上
// クライアントに露出する前提の値で、実際に読み書きを守っているのは
// database.rules.json側なので、ここを隠す意味は無い。

export const firebaseConfig = {
  apiKey: "AIzaSyD0C3ikhpynkELhTkt8PCagItolAkcYOLg",
  authDomain: "live-translate-e091c.firebaseapp.com",
  databaseURL: "https://live-translate-e091c-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "live-translate-e091c",
  storageBucket: "live-translate-e091c.firebasestorage.app",
  messagingSenderId: "956217183021",
  appId: "1:956217183021:web:08345bb43557af13f5a1a4"
};
