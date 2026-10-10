import {ScheduleRow} from "./ZGSupply";

/**
 * Finance's token release schedule: how much of the allocation has unlocked by each date.
 *
 * Columns 1-9 of the schedule, cumulated -- vesting, treasury and unlock terms, which are
 * written down there and nowhere else. Its column 10, an estimate of staking rewards, is
 * deliberately absent: issuance is measured from the chain, so `circulating` is this plus
 * `sumBlockReward` and never needs the estimate. That also means this table only changes
 * when the allocation plan does, not when issuance runs fast or slow.
 *
 * Dates are the unlock days themselves, so nothing here assumes a day of the month. TGE
 * landed 2025-09-22 and the unlocks follow on the 22nd, but a different cadence would be
 * a change to these rows and to nothing else.
 *
 * Checked against the schedule's own figures at both ends: the TGE row's nine allocation
 * cells sum to 285,010,133, and the total row's to 1,000,000,010. The 10 over genesis is
 * a rounding artifact already present in those columns.
 *
 * Updating this needs a deploy. It was briefly held in KV to avoid that, but a table that
 * moves once a quarter at most is not worth a second place to look when a figure is
 * wrong.
 */
export const TOKEN_RELEASE_SCHEDULE: ScheduleRow[] = [
	{timeline:  "TGE", date: "2025-09-22", tokenAllocation: "285010133"},
	{timeline:    "1", date: "2025-10-22", tokenAllocation: "291472943"},
	{timeline:    "2", date: "2025-11-22", tokenAllocation: "297935754"},
	{timeline:    "3", date: "2025-12-22", tokenAllocation: "304398564"},
	{timeline:    "4", date: "2026-01-22", tokenAllocation: "310861374"},
	{timeline:    "5", date: "2026-02-22", tokenAllocation: "317324185"},
	{timeline:    "6", date: "2026-03-22", tokenAllocation: "466019942"},
	{timeline:    "7", date: "2026-04-22", tokenAllocation: "472319048"},
	{timeline:    "8", date: "2026-05-22", tokenAllocation: "478618155"},
	{timeline:    "9", date: "2026-06-22", tokenAllocation: "484917261"},
	{timeline:   "10", date: "2026-07-22", tokenAllocation: "491216367"},
	{timeline:   "11", date: "2026-08-22", tokenAllocation: "497515474"},
	{timeline:   "12", date: "2026-09-22", tokenAllocation: "503814580"},
	{timeline:   "13", date: "2026-10-22", tokenAllocation: "510055353"},
	{timeline:   "14", date: "2026-11-22", tokenAllocation: "516296127"},
	{timeline:   "15", date: "2026-12-22", tokenAllocation: "522536900"},
	{timeline:   "16", date: "2027-01-22", tokenAllocation: "528777673"},
	{timeline:   "17", date: "2027-02-22", tokenAllocation: "535018447"},
	{timeline:   "18", date: "2027-03-22", tokenAllocation: "541259220"},
	{timeline:   "19", date: "2027-04-22", tokenAllocation: "547499993"},
	{timeline:   "20", date: "2027-05-22", tokenAllocation: "553740767"},
	{timeline:   "21", date: "2027-06-22", tokenAllocation: "559981540"},
	{timeline:   "22", date: "2027-07-22", tokenAllocation: "566222313"},
	{timeline:   "23", date: "2027-08-22", tokenAllocation: "572463087"},
	{timeline:   "24", date: "2027-09-22", tokenAllocation: "578703860"},
	{timeline:   "25", date: "2027-10-22", tokenAllocation: "597646755"},
	{timeline:   "26", date: "2027-11-22", tokenAllocation: "616589651"},
	{timeline:   "27", date: "2027-12-22", tokenAllocation: "635532546"},
	{timeline:   "28", date: "2028-01-22", tokenAllocation: "654475441"},
	{timeline:   "29", date: "2028-02-22", tokenAllocation: "673418336"},
	{timeline:   "30", date: "2028-03-22", tokenAllocation: "692361232"},
	{timeline:   "31", date: "2028-04-22", tokenAllocation: "711304127"},
	{timeline:   "32", date: "2028-05-22", tokenAllocation: "730247022"},
	{timeline:   "33", date: "2028-06-22", tokenAllocation: "749189917"},
	{timeline:   "34", date: "2028-07-22", tokenAllocation: "768132813"},
	{timeline:   "35", date: "2028-08-22", tokenAllocation: "787075708"},
	{timeline:   "36", date: "2028-09-22", tokenAllocation: "806018603"},
	{timeline:   "37", date: "2028-10-22", tokenAllocation: "822183720"},
	{timeline:   "38", date: "2028-11-22", tokenAllocation: "838348838"},
	{timeline:   "39", date: "2028-12-22", tokenAllocation: "854513955"},
	{timeline:   "40", date: "2029-01-22", tokenAllocation: "870679072"},
	{timeline:   "41", date: "2029-02-22", tokenAllocation: "886844189"},
	{timeline:   "42", date: "2029-03-22", tokenAllocation: "903009307"},
	{timeline:   "43", date: "2029-04-22", tokenAllocation: "919174424"},
	{timeline:   "44", date: "2029-05-22", tokenAllocation: "935339541"},
	{timeline:   "45", date: "2029-06-22", tokenAllocation: "951504658"},
	{timeline:   "46", date: "2029-07-22", tokenAllocation: "967669776"},
	{timeline:   "47", date: "2029-08-22", tokenAllocation: "983834893"},
	{timeline:   "48", date: "2029-09-22", tokenAllocation: "1000000010"},
];
