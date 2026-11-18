# Tej Automation

A desk for booking one Navis gate appointment per window.

The operator signs in with an organisation, fills the visit on Add Appointment, sets a date and one or more time ranges, and starts the run. The run enters that date, and at a Johannesburg release it takes the earliest or latest interval inside the ranges. One window books one container. Another container is another window.

The screen is a stand-in of Navis Add Appointment. A live Navis address is not connected. Use **Advance to** the next release to move the terminal clock onto 01:30, 06:30, 09:30, 13:30, 18:30, or 21:30. There is no release on 25 December or 1 January.

## Run it

```bash
npm install
npm test
npm run dev -- --port 4178
```

Open the desk, sign in, choose a gate and transaction, enter a container, and start the bot. Advance the clock if the terminal is between releases. A range of 10:00–10:19 books the 10:00 interval. A range covering 13:00 and 14:00 shows a quota reply, then a booking. A second window with the same container stops on a duplicate.
