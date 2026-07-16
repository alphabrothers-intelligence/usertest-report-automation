import { StyleSheet } from "@react-pdf/renderer";

export const colors = {
  navy: "#1e3a5f",
  navyLight: "#8fa8c9",
  teal: "#5eead4",
  tealDark: "#0d9488",
  amber: "#f59e0b",
  red: "#ef4444",
  text: "#18181b",
  subtext: "#52525b",
  border: "#d4d4d8",
  bgAlt: "#f4f4f5",
  white: "#ffffff",
};

export const styles = StyleSheet.create({
  page: {
    fontFamily: "Noto Sans KR",
    fontSize: 9,
    color: colors.text,
    paddingTop: 36,
    paddingBottom: 44,
    paddingHorizontal: 40,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.navy,
    marginBottom: 12,
  },
  sectionHeaderBadge: {
    color: colors.white,
    fontSize: 11,
    fontWeight: "bold",
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  sectionHeaderTitle: {
    flex: 1,
    color: colors.white,
    fontSize: 11,
    fontWeight: "bold",
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: colors.navyLight,
  },
  subheading: {
    fontSize: 10,
    fontWeight: "bold",
    marginTop: 10,
    marginBottom: 6,
  },
  body: {
    fontSize: 9,
    lineHeight: 1.5,
    color: colors.text,
  },
  small: {
    fontSize: 8,
    color: colors.subtext,
  },
  table: {
    borderWidth: 1,
    borderColor: colors.border,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableRowLast: {
    flexDirection: "row",
  },
  tableHeaderCell: {
    flex: 1,
    backgroundColor: colors.bgAlt,
    fontSize: 8,
    fontWeight: "bold",
    padding: 5,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  tableCell: {
    flex: 1,
    fontSize: 8,
    padding: 5,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  categoryBlock: {
    marginBottom: 8,
  },
  categoryLabel: {
    fontSize: 9,
    fontWeight: "bold",
    marginBottom: 2,
  },
  quote: {
    fontSize: 8.5,
    color: colors.subtext,
    marginLeft: 8,
    marginBottom: 1,
  },
  insight: {
    fontSize: 9,
    fontWeight: "bold",
    color: colors.tealDark,
    marginTop: 2,
  },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 40,
    right: 40,
    fontSize: 7,
    color: colors.subtext,
    textAlign: "center",
  },
  placeholder: {
    fontSize: 9,
    color: colors.subtext,
  },
});
