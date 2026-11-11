export default function ComplianceContextFields({ listId, year, showHidden, locationId, reminderLocationId }: {
  listId?: string; year: number; showHidden: boolean; locationId?: string; reminderLocationId?: string;
}) {
  return <>
    <input type="hidden" name="listId" value={listId ?? ""} />
    <input type="hidden" name="year" value={year} />
    <input type="hidden" name="showHidden" value={showHidden ? "1" : "0"} />
    {locationId && <input type="hidden" name="locationId" value={locationId} />}
    {reminderLocationId && <input type="hidden" name="reminderLocationId" value={reminderLocationId} />}
  </>;
}
