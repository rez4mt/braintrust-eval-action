import path from "path";
import * as core from "@actions/core";
import { exec as execSync } from "child_process";
import { z } from "zod";
import { Params } from "./main";
import { ExperimentSummary } from "braintrust";

export interface ExperimentFailure {
  evaluatorName: string;
  errors: string[];
}

type OnSummaryFn = (summary: (ExperimentSummary | ExperimentFailure)[]) => void;

const scoreSummarySchema = z.object({
  name: z.string(),
  score: z.number(),
  diff: z.number().optional(),
  improvements: z.number().optional(),
  regressions: z.number().optional(),
});

const metricSummarySchema = z.object({
  name: z.string(),
  metric: z.number(),
  unit: z.string(),
  diff: z.number(),
  improvements: z.number(),
  regressions: z.number(),
});

const experimentSummarySchema = z.object({
  projectName: z.string(),
  experimentName: z.string(),
  projectUrl: z.string().optional(),
  experimentUrl: z.string().optional(),
  comparisonExperimentName: z.string().optional(),
  scores: z.record(scoreSummarySchema),
  metrics: z.record(metricSummarySchema).optional(),
});

const experimentFailureSchema = z.object({
  evaluatorName: z.string(),
  errors: z.array(z.string()),
});

async function runCommand(command: string, onSummary: OnSummaryFn) {
  return new Promise((resolve, reject) => {
    const process = execSync(command);

    process.stdout?.on("data", (text: string) => {
      const parsedResult = text
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .flatMap(line => {
          try {
            const parsedLine = JSON.parse(line);

            if (experimentSummarySchema.safeParse(parsedLine).success) {
              return [parsedLine];
            }

            if (experimentFailureSchema.safeParse(parsedLine).success) {
              return [parsedLine];
            }
            core.info(line);
            return [];
          } catch (e) {
            core.error(`Failed to parse jsonl data: ${e}`);
            return [];
          }
        });

      if (parsedResult.length > 0) {
        onSummary(parsedResult);
      }
    });

    process.stderr?.on("data", data => {
      core.info(data); // Outputs the stderr of the command
    });

    process.on("close", code => {
      if (code === 0) {
        resolve(null);
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
  });
}

export async function runEval(args: Params, onSummary: OnSummaryFn) {
  const {
    api_key,
    root,
    paths,
    baseline_experiment_name,
    baseline_project_id,
    experiment_name,
    update_baseline,
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
      command = `tsx -r dotenv/config -r ./transform-env-vars.js -- ${paths} -c --baseline_experiment_name ${baseline_experiment_name} --baseline_project_id ${baseline_project_id}`;
      if (experiment_name) {
        command += ` --experiment_name ${experiment_name}`;
      }
      if (update_baseline) {
        command += ` --update_baseline ${update_baseline}`;
      }
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
