# Literature Review

## 1. Introduction

At a land border, a taxi rank funnels everyone through a few stands, so a small change in taxi numbers moves the wait a lot. This review defines *queueing* (passengers and taxis meeting at random), *virtual queueing* (keeping a place without standing in line), and *discrete-event simulation* (DES: replaying a day minute by minute). It covers rank queues, empty-trip repositioning, digital booking, and rules on taxi numbers, excluding pricing algorithms and driverless cars. The aim is to see what is known about cutting waits, and what is missing at a cross-border port. The next three parts follow those themes.

## 2. Main body

**Rank queues.** A rank is two queues feeding each other. A burst of people grows the passenger queue; when it stops, the taxi queue grows (Yang et al., 2024). Ji and Cheng (2021) found that messaging individual taxis beat a general call-out at closing the gap. App-based ride reviews describe dispatch as matching two sides of a market: drivers work more when they earn more (Wang & Yang, 2019).

**Digital and booking queues.** Virtual queuing at airport security lets people keep a place without standing in line (de Lange et al., 2013). Ports use truck booking to spread arrivals, but only when terminal and haulier goals align (Huynh et al., 2016; Torkjazi et al., 2018). Queueing models also predict border crossing times (Lin et al., 2014).

**Supply, information and rules.** Market models show rules can leave empty taxis in the wrong place and passengers without a ride (Buchholz, 2022). In Singapore, live demand information cut drivers' empty driving time by 10.8% (Agarwal et al., 2025). Who may enter the market is still argued about (Schaller, 2007). A model is only trustworthy if checked against reality (Sargent, 2013).

## 3. Conclusion and research gap

Overall, the studies agree that supply and queue discipline decide the wait, not stands alone. They disagree on live information: it helps drivers but can push the queue elsewhere. No study looks at a land port where three taxi types share one hall, taxis leave the port empty, and a paper ticket costs drivers time; cross-border data are scarce (Liu & Shi, 2021). Nor is there an open, checked simulation for testing policies in order. This project fills that gap with a DES of Huanggang Port, checked against Erlang-C and Little's Law.

## References




Agarwal, S., Cheng, S.-F., Keppo, J., Wang, L., & Yang, Y. (2025). Information provision and search frictions: Evidence from the taxi industry in Singapore. *The Review of Economics and Statistics*, 1–47. https://doi.org/10.1162/rest.a.1632

Buchholz, N. (2022). Spatial equilibrium, search frictions, and dynamic efficiency in the taxi industry. *The Review of Economic Studies, 89*(2), 556–591. https://doi.org/10.1093/restud/rdab050

de Lange, R., Samoilovich, I., & van der Rhee, B. (2013). Virtual queuing at airport security lanes. *European Journal of Operational Research, 225*(1), 153–165. https://doi.org/10.1016/j.ejor.2012.09.025

Huynh, N., Smith, D., & Harder, F. (2016). Truck appointment systems. *Transportation Research Record, 2548*(1), 1–9. https://doi.org/10.3141/2548-01

Ji, M., & Cheng, S.-F. (2021). Automated taxi queue management at high-demand venues. *2021 IEEE 17th International Conference on Automation Science and Engineering (CASE)*, 1757–1762. https://doi.org/10.1109/CASE49439.2021.9551601

Lin, L., Wang, Q., & Sadek, A. W. (2014). Border crossing delay prediction using transient multi-server queueing models. *Transportation Research Part A: Policy and Practice, 64*, 65–91. https://doi.org/10.1016/j.tra.2014.03.013

Liu, J., & Shi, W. (2021). A cross-boundary travel tale: Unraveling Hong Kong residents’ mobility pattern in Shenzhen by using metro smart card data. *Applied Geography, 130*, 102416. https://doi.org/10.1016/j.apgeog.2021.102416

Sargent, R. G. (2013). Verification and validation of simulation models. *Journal of Simulation, 7*(1), 12–24. https://doi.org/10.1057/jos.2012.20

Schaller, B. (2007). Entry controls in taxi regulation: Implications of US and Canadian experience for taxi regulation and deregulation. *Transport Policy, 14*(6), 490–506. https://doi.org/10.1016/j.tranpol.2007.04.010

Torkjazi, M., Huynh, N., & Shiri, S. (2018). Truck appointment systems considering impact to drayage truck tours. *Transportation Research Part E: Logistics and Transportation Review, 116*, 208–228. https://doi.org/10.1016/j.tre.2018.06.003

Wang, H., & Yang, H. (2019). Ridesourcing systems: A framework and review. *Transportation Research Part B: Methodological, 129*, 122–155. https://doi.org/10.1016/j.trb.2019.07.009

Yang, Q., Li, J., Wang, W., & Xu, M. (2024). Modeling the dynamical behavior of the passenger-taxi queue matching problem at traffic hubs. *Journal of Physics A: Mathematical and Theoretical, 58*(2), 025003. https://doi.org/10.1088/1751-8121/ad9e56
