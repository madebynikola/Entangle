# Example: a good industrial PhD topic

The partners below are invented. This page shows the shape a proposal should have and how specific it should be.

## Seeing seed quality before it's bought: computer vision for grading sunflower seed lots

**Company:** Semenka Plus d.o.o., a seed processor in Bačka (fictional), 90 employees, a quality lab and three processing lines.
**Faculty:** Faculty of Technical Sciences, Department of Computing and Control Engineering.
**Supervisors:** an associate professor in computer vision (academic) and the company's head of quality (industrial).
**Candidate:** a master's graduate in computer engineering, employed by the company for the three years.

### The problem
Every seed lot is graded by hand. A technician sorts a 500 g sample for broken, mouldy and foreign seeds, which takes 40 minutes. In September the lab grades 300 lots a week, so trucks wait and lots get mixed. Two technicians agree on a grade only 80% of the time.

### Research questions
1. Can images of a seed sample, taken on a conveyor, grade a lot as well as the lab does? Measured against three technicians' consensus on 2,000 historical lots.
2. Which defects can be seen at all? Mould shows on the surface; insect damage often doesn't. Can a second wavelength (near-infrared) close the gap?
3. How few labelled examples does a new seed variety need, given there are 40 varieties and new ones every year?

### Plan

| Year | Work | Result |
| --- | --- | --- |
| 1 | An imaging rig in the company's lab; a labelled set of 20,000 seeds from 200 lots; baseline models | A dataset paper; a working rig |
| 2 | Few-shot learning for new varieties; adding a near-infrared channel; measuring agreement with the lab | A journal paper; a prototype on one line |
| 3 | Trial on a processing line through one harvest; cost and time compared with manual grading | The thesis; a decision on rollout |

### What each side brings
- **Company:** samples, lab time, historical grades for 6 seasons, the line for the trial, the candidate's salary.
- **Faculty:** supervision, GPU time, a vision lab, and experience with few-shot defect detection.

### Why this pair
The company has a costly bottleneck with data already on hand. The faculty group has published on detecting defects from few examples, the core difficulty here. Neither could do it alone: the company has no ML staff, and the faculty has no seeds, labels or line.

### Agreed up front
- Results can be published after a 60-day review by the company.
- The company owns the rig and the trained models. The faculty keeps the methods.
