import path from "path";
import * as core from "@actions/core";
import { execSync } from "child_process";

import { Params } from "./main";
import { ExperimentSummary } from "braintrust";

export interface ExperimentFailure {
  evaluatorName: string;
  errors: string[];
}

type OnSummaryFn = (summary: (ExperimentSummary | ExperimentFailure)[]) => void;

async function runCommand(command: string, onSummary: OnSummaryFn) {
  return new Promise((resolve, reject) => {
    const stdout = execSync(command);

    const result = stdout.toString();
    core.info(result);

    try {
      const json = JSON.parse(result);

      core.info(json);
      onSummary([json as unknown as ExperimentSummary]);

      resolve(null);
    } catch (err) {
      core.error(`Failed to parse json: ${err}`);
      core.error(result);
      reject(err);
      return [];
    }
  });
}

export async function runEval(args: Params, onSummary: OnSummaryFn) {
  const {
    api_key,
    root,
    paths,
    baseline_experiment_name,
    baseline_project_id,
  } = args;

  // Add the API key to the environment
  core.exportVariable("BRAINTRUST_API_KEY", api_key);

  if (!process.env.OPENAI_API_KEY) {
    core.exportVariable("OPENAI_API_KEY", api_key);
  }

  if (args.use_proxy) {
    core.exportVariable("OPENAI_BASE_URL", "https://braintrustproxy.com/v1");
  }

  // Change working directory
  process.chdir(path.resolve(root));

  let command: string;
  switch (args.runtime) {
    case "loancrate":
      command = `tsx -r dotenv/config -r ./transform-env-vars.js -- ${paths} -c --baseline_experiment_name ${baseline_experiment_name} --baseline_project_id = ${baseline_project_id}`;
      break;
    case "node":
      command = `npx braintrust eval --jsonl ${paths}`;
      break;
    case "python":
      command = `braintrust eval --jsonl ${paths}`;
      break;
    default:
      throw new Error(`Unsupported runtime: ${args.runtime}`);
  }
  await runCommand(command, onSummary);
}
