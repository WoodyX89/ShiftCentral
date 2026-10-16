<<<<<<< HEAD
# ShiftCentral
An app for managing shift workers schedules.
=======
# ShiftCentral — multi-page (web + mobile)

Separate HTML pages, shared scripts in `app.js`, styles in `style.css`.

## Pages
- `index.html` — sign in and choose plant (only plants you belong to)
- `schedule.html` — interactive calendar of the applied crew schedule
- `rotation.html` — Admin / SS/LH set the crew rotation
- `admin.html` — members

## Rotation page
1. Enter crew name
2. Set rotation length in days → **Populate days** shows that many editable days (with weekdays)
3. Click days to set Off → Day → Night
4. Set the start date (weekdays follow this date)
5. Set how many days to populate
6. **Apply rotation to schedule** — saves the pattern and shows it on the schedule calendar

## Schedule page
Interactive month calendar. Select a crew to see its Day / Night / Off for the applied range.

## Run
Open `index.html` in a browser. For mobile, the same files wrap with Capacitor (`npx cap sync` after changes).

Scripts live in `app.js` — edit once, every page uses it.
>>>>>>> b54312e (Initial ShiftCentral app)
