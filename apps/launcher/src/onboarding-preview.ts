import type { ControlState } from './control-state';
export const onboardingPreview = import.meta.env.DEV && new URLSearchParams(location.search).has('onboarding');
export function previewState(): ControlState {
 return {profile:null,account:{signedIn:false},customProviders:[],credentials:[],providers:[{id:'openai',name:'OpenAI'},{id:'anthropic',name:'Anthropic'}],models:[{provider:'openai',id:'gpt-4.1',name:'GPT-4.1'},{provider:'anthropic',id:'claude-sonnet-4',name:'Claude Sonnet 4'}]};
}
export const onboardingText = {
 en:{japaneseHint:'Prefer Japanese explanations and reports. You can request another language in a conversation.',preferences:'Make Jouzu yours',connect:'Connect a model',hint:'Sign in with Shisa or connect another provider to get started.',next:'Continue',workspaces:'Return to workspaces',models:'Return to model setup',back:'Back',review:'Preview',reset:'New user',existing:'Saved preferences',ready:'Configured',complete:'Complete demo authorization'},
 ja:{japaneseHint:'説明やレポートでは日本語を優先します。会話中に別の言語を指定できます。',preferences:'Jouzu の初期設定',connect:'モデルに接続',hint:'Shisa にログインするか、他のサービスに接続して始めましょう。',next:'次へ',workspaces:'ワークスペースに戻る',models:'モデル設定に戻る',back:'戻る',review:'プレビュー',reset:'初回設定',existing:'設定済みの環境',ready:'接続済み',complete:'デモ認証を完了'},
 'zh-Hans':{japaneseHint:'优先使用日语解释和汇报。你仍可在对话中要求使用其他语言。',preferences:'按你的习惯设置 Jouzu',connect:'连接模型',hint:'登录 Shisa，或连接其他服务，即可开始使用。',next:'继续',workspaces:'返回工作区',models:'返回模型设置',back:'上一步',review:'预览',reset:'首次设置',existing:'已有偏好',ready:'已配置',complete:'完成模拟授权'},
 'zh-Hant':{japaneseHint:'優先使用日語說明和彙報。你仍可在對話中要求使用其他語言。',preferences:'依照你的習慣設定 Jouzu',connect:'連接模型',hint:'登入 Shisa，或連接其他服務，即可開始使用。',next:'繼續',workspaces:'返回工作區',models:'返回模型設定',back:'上一步',review:'預覽',reset:'首次設定',existing:'已有偏好',ready:'已設定',complete:'完成模擬授權'},
};
