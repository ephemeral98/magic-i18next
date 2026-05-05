import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

/**
 * 询问生成文件
 * @returns 语言代码
 */
export async function readInpJsonDir(): Promise<string> {
  const rl = readline.createInterface({ input, output });
  const timeoutInSeconds = 30;
  const ac = new AbortController();
  const signal = ac.signal;

  // 必须 clearTimeout：否则即使用户已输入，Node 仍会等满 30s 才结束进程（定时器占着事件循环）
  const timer = setTimeout(() => ac.abort(), timeoutInSeconds * 1000);

  try {
    const lang = await rl.question(
      '🌐 请选择要生成/转换的语言代码（直接回车默认 cn）: ',
      { signal }
    );

    rl.close();
    return lang || 'cn';
  } catch (err) {
    let message = '❌ 输入异常，已使用默认语言 cn。';
    if (err.code === 'ABORT_ERR') {
      message = `⏱️ 超时（${timeoutInSeconds} 秒内未输入），已使用默认语言 cn。`;
    }
    console.log(message);
    rl.close();
    return 'cn';
  } finally {
    clearTimeout(timer);
  }
}
