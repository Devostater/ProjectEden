<!-- Written by local Ollama (model: qwen2.5-coder:7b) for roadmap round 1 (#10), 2026-11-16. Unedited AI output; reviewed in the overview. -->

# Local AI (Ollama) in the EDEN plan

## Job Assignment
1. **First Drafts**: Local AI will handle initial ideation, concept development, and first drafts for documents, scripts, and design documents. This will help reduce the load on paid cloud AIs and ensure quick iterations.
   - **Done When**: Initial drafts for the first level generator plugin are ready within 24 hours.

2. **Test Case Lists**: Local AI will create test case lists and basic test scripts for each component of the plugin. This will help in early quality assurance.
   - **Done When**: Test case lists for the level generator plugin are created and reviewed within 1 week.

3. **Summaries and Reports**: Local AI will generate summaries and reports for project milestones and progress updates. This will ensure timely communication and accountability.
   - **Done When**: Weekly progress reports are completed and shared with the team within 1 day.

4. **Code Review of Small Diffs**: Local AI will conduct initial code reviews for small diffs and suggest minor improvements. This will free up paid AIs for more complex reviews.
   - **Done When**: Initial code reviews for 10 small diffs are completed within 1 week.

5. **Keeping Running When Cloud AIs Hit Limits or PC is Offline**: Local AI will continue working on tasks when the cloud AIs hit their limits or when the PC is offline. This ensures continuous progress without interruptions.
   - **Done When**: The swarm is able to continue working on tasks when the cloud AIs hit their limits or when the PC is offline for 1 week.

## Model Assignments and PC Memory Trade-offs
1. **gpt-oss:20b**: This model will be used for large-scale tasks that require a lot of memory and computational power, such as generating complex designs and creating detailed reports.
   - **PC Memory Trade-offs**: The PC may experience memory constraints when running this model. EDEN should ensure that the PC has sufficient RAM and consider adding additional memory if necessary.

2. **qwen2.5-coder:14b**: This model will be used for code generation and small code reviews. It has a balance between memory usage and computational power.
   - **PC Memory Trade-offs**: This model should work well with the existing PC configuration. EDEN should monitor memory usage and ensure that the model is not using too much memory.

3. **qwen2.5-coder:7b**: This model will be used for initial code reviews and generating test case lists. It has a lower memory footprint than the other models.
   - **PC Memory Trade-offs**: This model should work well with the existing PC configuration. EDEN should monitor memory usage and ensure that the model is not using too much memory.

4. **qwen3.5:4b**: This model will be used for generating summaries and reports. It has a lower memory footprint than the other models.
   - **PC Memory Trade-offs**: This model should work well with the existing PC configuration. EDEN should monitor memory usage and ensure that the model is not using too much memory.

## Limits and Risks of Local Models
1. **Quality**: Local models may not have the same level of expertise and knowledge as paid cloud AIs. EDEN should conduct regular reviews and testing to ensure that the quality of the work is consistent.
2. **Speed**: Local models may be slower than paid cloud AIs, especially for large-scale tasks. EDEN should ensure that the local models are optimized for performance and that the team is aware of any potential delays.
3. **Memory**: Local models may have limited memory and computational power, which can affect their ability to handle large-scale tasks. EDEN should monitor memory usage and ensure that the local models are not using too much memory.

## Concrete Tasks for Local AI in the In-house Test
1. **Generate First Drafts for Level Generator Plugin**: Generate initial drafts for the level generator plugin and submit them for review.
   - **Done When**: Initial drafts for the level generator plugin are ready within 24 hours.

2. **Create Test Case Lists**: Create test case lists for the level generator plugin and submit them for review.
   - **Done When**: Test case lists for the level generator plugin are created and reviewed within 1 week.

3. **Generate Summaries and Reports**: Generate summaries and reports for the project milestones and progress updates.
   - **Done When**: Weekly progress reports are completed and shared with the team within 1 day.

4. **Conduct Initial Code Reviews for Small Diffs**: Conduct initial code reviews for 10 small diffs and suggest minor improvements.
   - **Done When**: Initial code reviews for 10 small diffs are completed within 1 week.

5. **Ensure Continuous Progress When Cloud AIs Hit Limits or PC is Offline**: Ensure that the swarm is able to continue working on tasks when the cloud AIs hit their limits or when the PC is offline for 1 week.
