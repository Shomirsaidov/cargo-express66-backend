const fs = require('fs');
const readline = require('readline');

async function processLineByLine() {
  const fileStream = fs.createReadStream('/Users/shomirsaidov/.gemini/antigravity/brain/3624bdcf-7281-4b15-a5e2-c299a27701b8/.system_generated/logs/transcript.jsonl');
  const outStream = fs.createWriteStream('/Users/shomirsaidov/.gemini/antigravity/brain/3624bdcf-7281-4b15-a5e2-c299a27701b8/scratch/extracted_schema.sql');

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let foundCalls = 0;

  for await (const line of rl) {
    const obj = JSON.parse(line);
    
    if (obj.tool_calls && Array.isArray(obj.tool_calls)) {
      obj.tool_calls.forEach(tc => {
        const name = tc.name || '';
        const args = tc.args || {};
        
        const isMcp = name === 'call_mcp_tool';
        const isExecuteSql = isMcp && (args.ToolName === 'execute_sql' || (args.Arguments && JSON.stringify(args.Arguments).includes('query')));
        
        if (isExecuteSql || name.includes('execute_sql')) {
          foundCalls++;
          outStream.write(`-- -----------------------------------------------------\n`);
          outStream.write(`-- Tool Call: ${name} (ToolName: ${args.ToolName}) at Step ${obj.step_index}\n`);
          outStream.write(`-- -----------------------------------------------------\n`);
          
          const mcpArgs = args.Arguments || {};
          const query = mcpArgs.query || mcpArgs.sql || JSON.stringify(mcpArgs);
          outStream.write(`${query}\n\n`);
        }
      });
    }
  }

  outStream.end();
  console.log(`Extracted ${foundCalls} MCP execute_sql tool calls! Output written to extracted_schema.sql`);
}

processLineByLine();
