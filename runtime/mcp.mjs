import readline from 'node:readline';
import { serviceRequest, launchDesktop } from './process.mjs';
import { VERSION } from './paths.mjs';

const toolSpecs = [
  { name: 'dragon_quota', description: '查询 Codex 官方订阅额度、剩余比例和重置时间；本机 token 统计不等于官方剩余额度。', inputSchema: { type: 'object', properties: { refresh: { type: 'boolean', description: '立即刷新官方订阅额度' } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'dragon_usage', description: '读取小龙娘今日、近七天和历史用量记录。每日合计只覆盖挂件已观测时段，逐模型金额为配置价格估算。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'dragon_status', description: '读取当前服务商、挂件状态和 Codex 会话用量监听状态，不返回 API 密钥。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'dragon_open', description: '显示跟随 Codex 窗口的 Codex 小龙娘。使用本地透明挂件，无网页地址；角色、音效、气泡编辑和资源管理均在挂件中操作。', inputSchema: { type: 'object', properties: { desktop: { type: 'boolean', description: '打开 Windows 透明桌面悬浮挂件' } }, additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
];

const send = value => process.stdout.write(JSON.stringify(value) + '\n');
async function dispatch(message) {
  const { id, method, params = {} } = message;
  if (id === undefined) return;
  try {
    let result;
    if (method === 'initialize') result = { protocolVersion: ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'].includes(params.protocolVersion) ? params.protocolVersion : '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'codex-dragon-maiden-widget', version: VERSION } };
    else if (method === 'ping') result = {};
    else if (method === 'tools/list') result = { tools: toolSpecs };
    else if (method === 'resources/list' || method === 'resources/templates/list') result = method === 'resources/list' ? { resources: [] } : { resourceTemplates: [] };
    else if (method === 'tools/call') {
      const args = params.arguments || {};
      let output;
      if (params.name === 'dragon_quota') output = await serviceRequest('/api/insights' + (args.refresh ? '?refresh=1' : ''));
      else if (params.name === 'dragon_usage') output = await serviceRequest('/dsh-whale/usage-records.json');
      else if (params.name === 'dragon_status') output = await serviceRequest('/api/status');
      else if (params.name === 'dragon_open') {
        if (args.desktop) output = await launchDesktop();
        else output = await launchDesktop();
      } else throw new Error('未知工具');
      result = { content: [{ type: 'text', text: JSON.stringify(output) }], isError: output.ok === false };
    } else { send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }); return; }
    send({ jsonrpc: '2.0', id, result });
  } catch { send({ jsonrpc: '2.0', id, error: { code: -32603, message: '挂件操作失败，请确认 Codex 桌面应用和自动跟随组件已运行' } }); }
}
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => {
  if (line.length > 1024 * 1024) return;
  try { const message = JSON.parse(line); if (message.jsonrpc === '2.0') dispatch(message); }
  catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
});
input.on('close', () => process.exit(0));
